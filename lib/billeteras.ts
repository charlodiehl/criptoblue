// ─────────────────────────────────────────────────────────────────────────────
// Ingresos por billetera (para el menú lateral de Administración Financiera).
//
// Un pago pasa por dos estados, y se fecha distinto en cada uno:
//   • EN COLA (aún sin emparejar) → figura en su día de INGRESO (payment.fechaPago).
//   • EMPAREJADO (manual o auto)  → sale de la cola y pasa a figurar en el día del
//     EMPAREJAMIENTO (registro_log.ts). Su línea "en cola" del día de ingreso
//     desaparece sola, porque el pago ya no está en unmatchedPayments.
// Los pagos marcados "No es de tiendas" (externallyMarkedPayments) se EXCLUYEN
// de la liquidación: no suman al total ni aparecen en el extracto.
//
// SIN CORTE: a diferencia de las tiendas, las billeteras cuentan desde el primer
// movimiento. BALANCE_CUTOFF aplica solo a tiendas.
//
// Saldo = ingresos − comisión − reembolsos − salidas (retiros / transferencias).
//
// Fuente derivada, sin tabla de ingresos:
//   • Emparejados    → tabla registro_log.
//   • No emparejados → cola unmatchedPayments de criptoblue:state.
//   • Salidas        → tabla wallet_movements.
// En teoría un pago está emparejado O en la cola, nunca en las dos. En la práctica
// se vieron pagos emparejados que quedaron igual en la cola (se contaban dos veces),
// así que la cola se deduplica contra los ids de registro_log: manda el registro.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, kvGet, loadHotState } from './storage'
import { PAYMENT_SOURCE_TO_WALLET, PAYMENT_SOURCE_NAMES, WALLETS } from './config'
import { getComisiones, comisionBilletera } from './comisiones'
import { sumRefundsByWallet, getRefundsDeWallet } from './reembolsos'
import { sumSalidasByWallet, getSalidasDeWallet, type SalidaBilletera } from './billetera-salidas'

export type { SalidaBilletera }

const OCULTAS_KEY = 'criptoblue:billeteras-ocultas'
const EXTRACTO_LIMIT = 200
const MATCHED_ACTIONS = ['auto_paid', 'manual_paid']
const CORTES_KEY = 'criptoblue:billetera-cortes'

// Corte por billetera: fecha desde la que se cuenta y saldo inicial (NETO) previo,
// que se suma al total. Espejo del BALANCE_CUTOFF de tiendas pero por billetera y
// configurable en kv (criptoblue:billetera-cortes): { "MF": { desde, saldoInicial } }.
// Sin corte configurado, la billetera cuenta todo su histórico (comportamiento default).
export interface CorteBilletera { desde: number; saldoInicial: number } // desde = epoch ms
export async function getCortesBilletera(): Promise<Record<string, CorteBilletera>> {
  const raw = await kvGet<Record<string, { desde: string; saldoInicial: number }>>(CORTES_KEY)
  const out: Record<string, CorteBilletera> = {}
  for (const [w, c] of Object.entries(raw ?? {})) {
    const t = new Date(c?.desde).getTime()
    if (Number.isFinite(t) && Number.isFinite(c?.saldoInicial)) out[w] = { desde: t, saldoInicial: Number(c.saldoInicial) }
  }
  return out
}

export interface IngresoBilletera {
  wallet: string
  totalArs: number          // NETO (comisión, reembolsos y salidas ya descontados)
  cantidad: number
  comisionArs: number       // comisión cobrada en ARS (positivo)
  comisionPct: number       // porcentaje aplicado (ej. 1)
  reembolsosArs: number     // total reembolsado desde esta billetera (positivo)
  salidasArs: number        // total retirado/transferido desde esta billetera (positivo)
}

export interface PagoBilletera {
  fecha: string
  titular: string
  monto: number
  comision: number          // comisión ARS de este pago (monto × pct/100)
  estado: 'emparejado' | 'en_cola'
}

export interface ReembolsoBilletera {
  orderNumber: string
  monto: number             // ARS reembolsado (positivo)
  seq: number
  fecha: string
}

// Una salida de plata del día: retiro/transferencia o reembolso. Se muestran juntos
// en una tabla debajo de los pagos, porque ambos bajan el saldo de ese día.
// moneda/montoOrigen/cotizacion vienen del formulario de "Retirar saldo": si el
// retiro fue en USD o USDT, la tabla muestra el monto original y la tasa aplicada.
export interface MovimientoDia {
  clase: 'retiro' | 'reembolso' | 'ajuste'
  fecha: string
  concepto: string                        // motivo del retiro, u "Orden #123" del reembolso
  moneda: 'ARS' | 'USD' | 'USDT'
  montoOrigen: number                     // monto en la moneda del retiro
  cotizacion: number | null               // ARS por unidad; null si ya era ARS
  ars: number                             // retiro/reembolso: sale (resta). ajuste: suma.
}

export interface DetalleBilletera {
  wallet: string
  totalArs: number          // NETO acumulado (comisión, reembolsos y salidas descontados)
  cantidad: number
  comisionArs: number       // comisión total ARS
  comisionPct: number
  reembolsosArs: number     // total reembolsado desde esta billetera (positivo)
  reembolsos: ReembolsoBilletera[]  // detalle de los reembolsos (misma info que a la tienda)
  salidasArs: number        // total retirado/transferido (positivo)
  salidas: SalidaBilletera[]        // detalle de retiros y transferencias
  totalDia?: number         // ingresos brutos del día seleccionado
  cantidadDia?: number
  // Balance del día: ingresos − comisión − retiros − reembolsos
  comisionDia?: number
  salidasDiaArs?: number
  reembolsosDiaArs?: number
  ajustesDiaArs?: number            // saldo inicial del corte, si cae en el día
  saldoDia?: number
  movimientosDia?: MovimientoDia[]  // retiros, reembolsos y ajuste (saldo inicial) del día
  pagos: PagoBilletera[]    // del día seleccionado, o todos si no se pidió día
}

// Dos fechas distintas, y no hay que confundirlas:
//   • fechaDia   → agrupa/filtra por día. Emparejado: el día del match. En cola: el de ingreso.
//   • fechaPago  → lo que se MUESTRA. Siempre cuándo entró la plata, aunque sea de otro día.
interface Ingreso {
  source: string
  monto: number
  fechaDia: string
  fechaPago: string
  titular: string
  estado: 'emparejado' | 'en_cola'
}

// Resuelve el payment.source de un pago a su billetera. Tolerante con datos
// históricos "sucios": además de las claves canónicas (mercadopago, fiwind, …),
// reconoce cuando el source quedó guardado como el nombre de la billetera (MF,
// Lacar, …) o su nombre para mostrar (Mileidy = mercadopago → MF). Los sources
// desconocidos (nombres sueltos, "-", etc.) devuelven null → no se cuentan.
const WALLET_SET = new Set<string>(WALLETS as readonly string[])
export function resolveWallet(source?: string | null): string | null {
  if (!source) return null
  const canon = PAYMENT_SOURCE_TO_WALLET[source]
  if (canon) return canon
  if (WALLET_SET.has(source)) return source
  const srcKey = Object.entries(PAYMENT_SOURCE_NAMES).find(([, disp]) => disp === source)?.[0]
  return srcKey ? (PAYMENT_SOURCE_TO_WALLET[srcKey] ?? null) : null
}

// Todas las etiquetas de source que resuelven a una billetera (claves canónicas +
// nombre de billetera + nombres para mostrar).
function sourceLabelsDeBilletera(wallet: string): string[] {
  const canon = Object.entries(PAYMENT_SOURCE_TO_WALLET)
    .filter(([, w]) => w === wallet)
    .map(([source]) => source)
  const labels = new Set<string>(canon)
  labels.add(wallet)
  for (const s of canon) if (PAYMENT_SOURCE_NAMES[s]) labels.add(PAYMENT_SOURCE_NAMES[s])
  return [...labels]
}

// Billeteras que el usuario pidió ocultar (se eliminan del menú y su panel).
export async function getBilleterasOcultas(): Promise<string[]> {
  const list = await kvGet<string[]>(OCULTAS_KEY)
  return Array.isArray(list) ? list : []
}

// IDs de todos los pagos ya emparejados (de cualquier fecha). El emparejamiento
// debería sacar el pago de la cola, pero si por una inconsistencia queda en las
// dos partes lo contaríamos dos veces. Con este set la cola se deduplica contra
// el registro: manda el registro (el pago ya está emparejado).
async function idsEmparejados(): Promise<Set<string>> {
  const c = getClient()
  const out = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (c.from('registro_log') as any)
      .select('mp_payment_id')
      .eq('hidden', false)
      .in('action', MATCHED_ACTIONS)
      .not('mp_payment_id', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`idsEmparejados falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) if (r.mp_payment_id) out.add(r.mp_payment_id as string)
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Pagos EMPAREJADOS. En una billetera lo que importa es CUÁNDO ENTRÓ la plata, no
// cuándo se emparejó: por eso se agrupan y se muestran por `payment.fechaPago` (con
// `payment_received_at` y `ts` de respaldo). Un pago emparejado tres días después
// sigue perteneciendo al día en que ingresó. (Las tiendas hacen lo contrario: la
// orden figura el día del emparejamiento — ese camino vive en lib/balance.ts.)
// Sin corte: se trae todo el histórico de la billetera.
async function ingresosEmparejados(): Promise<Ingreso[]> {
  const c = getClient()
  const out: Ingreso[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (c.from('registro_log') as any)
      .select('amount, ts, payment_received_at, source:payment->>source, monto:payment->>monto, titular:payment->>nombrePagador, fechaPago:payment->>fechaPago')
      .eq('hidden', false)
      .in('action', MATCHED_ACTIONS)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`ingresosEmparejados falló: ${error.message} [${error.code}]`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      if (!r.source || !r.ts) continue
      const ingreso = r.fechaPago || r.payment_received_at || r.ts
      out.push({
        source: r.source,
        monto: Number(r.monto ?? r.amount) || 0,
        fechaDia: ingreso,     // agrupa por el día en que ENTRÓ el pago (no el del match)
        fechaPago: ingreso,    // y se muestra con esa misma fecha
        titular: r.titular || '',
        estado: 'emparejado',
      })
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Pagos EN COLA (no emparejados), excluyendo los marcados "No es de tiendas" y
// los que YA están emparejados en el registro (quedaron en la cola por una
// inconsistencia: se contarían dos veces). labelSet opcional acota a una billetera.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ingresosEnCola(hot: any, emparejadosIds: Set<string>, labelSet?: Set<string>): Ingreso[] {
  const externos = new Set((hot.externallyMarkedPayments ?? []).map((e: { id: string }) => e.id))
  const out: Ingreso[] = []
  for (const u of hot.unmatchedPayments ?? []) {
    const p = u.payment
    if (!p?.source) continue
    if (labelSet && !labelSet.has(p.source)) continue
    const id = u.mpPaymentId || p.mpPaymentId
    if (externos.has(id)) continue
    if (emparejadosIds.has(id)) continue   // ya emparejado: lo aporta el registro
    const fecha = p.fechaPago || u.timestamp || ''
    out.push({
      source: p.source,
      monto: Number(p.monto) || 0,
      fechaDia: fecha,     // mientras está en cola, agrupa por su día de ingreso…
      fechaPago: fecha,    // …que es la misma fecha que se muestra
      titular: p.nombrePagador || '',
      estado: 'en_cola',
    })
  }
  return out
}

// Total por billetera (para los ítems del menú). Muestra TODAS las billeteras
// (aunque el saldo sea 0), salvo las ocultas.
export async function getIngresosBilleteras(): Promise<IngresoBilletera[]> {
  const [emparejados, hot, ocultas, cfg, reembolsosPorWallet, salidasPorWallet, yaEmparejados, cortes] = await Promise.all([
    ingresosEmparejados(),
    loadHotState(),
    getBilleterasOcultas(),
    getComisiones(),
    sumRefundsByWallet(),
    sumSalidasByWallet(),
    idsEmparejados(),
    getCortesBilletera(),
  ])
  const cola = ingresosEnCola(hot, yaEmparejados)

  // Arranca todas las billeteras en 0 → siempre aparecen, con su saldo de hoy.
  const acc = new Map<string, { totalArs: number; cantidad: number }>()
  for (const w of WALLETS) acc.set(w, { totalArs: 0, cantidad: 0 })
  const sumar = (wallet: string | null, monto: number, fechaDia: string) => {
    if (!wallet) return
    // Con corte, los ingresos previos ya están en el saldo inicial: no se recuentan.
    const corte = cortes[wallet]
    if (corte && (new Date(fechaDia).getTime() || 0) < corte.desde) return
    const cur = acc.get(wallet) ?? { totalArs: 0, cantidad: 0 }
    cur.totalArs += monto
    cur.cantidad += 1
    acc.set(wallet, cur)
  }
  for (const m of emparejados) sumar(resolveWallet(m.source), m.monto, m.fechaDia)
  for (const m of cola) sumar(resolveWallet(m.source), m.monto, m.fechaDia)

  const ocultasSet = new Set(ocultas)
  return [...acc.entries()]
    .filter(([wallet]) => !ocultasSet.has(wallet))
    .map(([wallet, v]) => {
      const pct = comisionBilletera(cfg, wallet)
      const comisionArs = v.totalArs * pct / 100
      const reembolsosArs = reembolsosPorWallet[wallet] ?? 0
      const salidasArs = salidasPorWallet[wallet] ?? 0
      // El saldo baja por la comisión (nuestra), los reembolsos (dinero devuelto al
      // cliente) y las salidas (retiros y transferencias hechas desde la billetera).
      // Con corte se le suma el saldo inicial (neto) previo al corte.
      const saldoInicial = cortes[wallet]?.saldoInicial ?? 0
      return {
        wallet,
        totalArs: saldoInicial + v.totalArs - comisionArs - reembolsosArs - salidasArs,
        cantidad: v.cantidad,
        comisionArs, comisionPct: pct, reembolsosArs, salidasArs,
      }
    })
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
}

// Días (ART) en los que la billetera tuvo algún movimiento: un pago que entró o se
// emparejó, un retiro o un reembolso. El calendario deshabilita el resto, para que
// no se pueda elegir un día que seguro está vacío.
export async function getDiasConMovimiento(wallet: string): Promise<string[]> {
  const labels = sourceLabelsDeBilletera(wallet)
  if (labels.length === 0) return []
  const labelSet = new Set(labels)

  const [emparejados, hot, refunds, salidas, yaEmparejados, cortes] = await Promise.all([
    ingresosEmparejados(), loadHotState(), getRefundsDeWallet(wallet), getSalidasDeWallet(wallet), idsEmparejados(), getCortesBilletera(),
  ])
  const desdeCorte = cortes[wallet]?.desde ?? -Infinity

  // Argentina es UTC-3 fijo: restar 3h y quedarse con la fecha.
  const diaART = (f: string) => {
    const t = new Date(f).getTime()
    if (!Number.isFinite(t)) return null
    return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }

  const dias = new Set<string>()
  // Días previos al corte no se listan: su saldo ya está en el saldo inicial.
  const agregar = (f: string) => {
    if ((new Date(f).getTime() || 0) < desdeCorte) return
    const d = diaART(f); if (d) dias.add(d)
  }

  for (const m of emparejados) if (labelSet.has(m.source)) agregar(m.fechaDia)
  for (const m of ingresosEnCola(hot, yaEmparejados, labelSet)) agregar(m.fechaDia)
  for (const s of salidas) agregar(s.fecha)
  for (const r of refunds) agregar(r.createdAt)

  // El día del corte siempre se lista (aunque no haya pagos): ahí figura el saldo inicial.
  if (cortes[wallet]) { const d = diaART(new Date(cortes[wallet].desde).toISOString()); if (d) dias.add(d) }

  return [...dias].sort()
}

// Detalle de una billetera: total acumulado (histórico) + extracto de pagos.
// Si se pasa diaART ('YYYY-MM-DD'), el extracto se acota a ese día (ART) y se
// devuelve además el subtotal del día. El total acumulado no cambia por el día.
export async function getIngresosBilletera(wallet: string, diaART?: string): Promise<DetalleBilletera> {
  const cfg = await getComisiones()
  const pct = comisionBilletera(cfg, wallet)
  const labels = sourceLabelsDeBilletera(wallet)
  if (labels.length === 0) {
    return { wallet, totalArs: 0, cantidad: 0, comisionArs: 0, comisionPct: pct, reembolsosArs: 0, reembolsos: [], salidasArs: 0, salidas: [], pagos: [] }
  }
  const labelSet = new Set(labels)

  const [emparejados, hot, refundsAll, salidasAll, yaEmparejados, cortes] = await Promise.all([
    ingresosEmparejados(), loadHotState(), getRefundsDeWallet(wallet), getSalidasDeWallet(wallet), idsEmparejados(), getCortesBilletera(),
  ])
  // Corte: se cuenta desde `desde`; lo previo ya está en el saldo inicial (neto).
  const corte = cortes[wallet]
  const desdeCorte = corte?.desde ?? -Infinity
  const saldoInicial = corte?.saldoInicial ?? 0
  const enPeriodo = (f: string) => (new Date(f).getTime() || 0) >= desdeCorte

  const ingresos = [
    ...emparejados.filter(m => labelSet.has(m.source)),
    ...ingresosEnCola(hot, yaEmparejados, labelSet),
  ].filter(m => enPeriodo(m.fechaDia))
  const refunds = refundsAll.filter(r => enPeriodo(r.createdAt))
  const salidas = salidasAll.filter(s => enPeriodo(s.fecha))

  // Total acumulado: saldo inicial + bruto → comisión → reembolsos → salidas → neto.
  let totalArsBruto = 0
  for (const m of ingresos) totalArsBruto += m.monto
  const comisionArs = totalArsBruto * pct / 100
  const reembolsosArs = refunds.reduce((s, r) => s + r.monto, 0)
  const salidasArs = salidas.reduce((s, r) => s + r.ars, 0)

  // Filtro por día (ART) para el extracto: se acota por fechaDia, que en billeteras es
  // siempre el día en que ENTRÓ el pago (emparejado o en cola, da igual). Los retiros y
  // reembolsos se acotan por su propia fecha: figuran en el día en que se hicieron.
  let visibles = ingresos
  let totalDia: number | undefined
  let cantidadDia: number | undefined
  let comisionDia: number | undefined
  let salidasDiaArs: number | undefined
  let reembolsosDiaArs: number | undefined
  let ajustesDiaArs: number | undefined
  let saldoDia: number | undefined
  let movimientosDia: MovimientoDia[] | undefined

  if (diaART && /^\d{4}-\d{2}-\d{2}$/.test(diaART)) {
    const desde = new Date(`${diaART}T00:00:00-03:00`).getTime()
    const hasta = desde + 24 * 60 * 60 * 1000
    const enElDia = (f: string) => {
      const t = new Date(f).getTime() || 0
      return t >= desde && t < hasta
    }

    visibles = ingresos.filter(m => enElDia(m.fechaDia))
    totalDia = visibles.reduce((s, m) => s + m.monto, 0)
    cantidadDia = visibles.length

    const salidasDelDia = salidas.filter(s => enElDia(s.fecha))
    const refundsDelDia = refunds.filter(r => enElDia(r.createdAt))
    salidasDiaArs = salidasDelDia.reduce((s, r) => s + r.ars, 0)
    reembolsosDiaArs = refundsDelDia.reduce((s, r) => s + r.monto, 0)
    comisionDia = totalDia * pct / 100
    // Si el corte cae en este día, el saldo inicial figura como un ajuste (suma).
    const corteEnDia = corte != null && corte.desde >= desde && corte.desde < hasta
    ajustesDiaArs = corteEnDia ? saldoInicial : 0
    saldoDia = totalDia - comisionDia - salidasDiaArs - reembolsosDiaArs + ajustesDiaArs

    const [aa, mm, dd] = diaART.split('-')
    movimientosDia = [
      // El saldo inicial del corte se muestra como un ajuste (positivo) al inicio del día.
      ...(corteEnDia ? [{
        clase: 'ajuste' as const, fecha: new Date(corte!.desde).toISOString(),
        concepto: `Saldo inicial al ${dd}/${mm}/${aa}`,
        ars: saldoInicial, moneda: 'ARS' as const, montoOrigen: saldoInicial, cotizacion: null,
      }] : []),
      ...salidasDelDia.map((s): MovimientoDia => ({
        clase: 'retiro', fecha: s.fecha, concepto: s.motivo, ars: s.ars,
        moneda: s.moneda, montoOrigen: s.montoOrigen, cotizacion: s.cotizacion,
      })),
      // Un reembolso siempre se devuelve en ARS: no hay conversión que mostrar.
      ...refundsDelDia.map((r): MovimientoDia => ({
        clase: 'reembolso', fecha: r.createdAt, ars: r.monto,
        concepto: `Reembolso orden #${r.orderNumber}${r.seq > 1 ? ` (${r.seq})` : ''}`,
        moneda: 'ARS' as const, montoOrigen: r.monto, cotizacion: null,
      })),
    ].sort((a, b) => (new Date(a.fecha).getTime() || 0) - (new Date(b.fecha).getTime() || 0))
  }

  // Ascendente por la fecha que se muestra (la del pago): los más antiguos arriba.
  visibles.sort((a, b) => (new Date(a.fechaPago).getTime() || 0) - (new Date(b.fechaPago).getTime() || 0))

  return {
    wallet,
    totalArs: saldoInicial + totalArsBruto - comisionArs - reembolsosArs - salidasArs,  // NETO (incluye saldo inicial del corte)
    cantidad: ingresos.length,
    comisionArs, comisionPct: pct,
    reembolsosArs,
    reembolsos: refunds.map(r => ({ orderNumber: r.orderNumber, monto: r.monto, seq: r.seq, fecha: r.createdAt })),
    salidasArs,
    salidas,
    totalDia,
    cantidadDia,
    comisionDia,
    salidasDiaArs,
    reembolsosDiaArs,
    ajustesDiaArs,
    saldoDia,
    movimientosDia,
    // Al estar ordenado ascendente, el tope deja los EXTRACTO_LIMIT más antiguos.
    pagos: visibles.slice(0, EXTRACTO_LIMIT).map(m => ({
      fecha: m.fechaPago,   // siempre la fecha del pago, aunque el día elegido sea otro
      titular: m.titular,
      monto: m.monto,
      comision: m.monto * pct / 100,
      estado: m.estado,
    })),
  }
}
