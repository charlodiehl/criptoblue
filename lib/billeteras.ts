// ─────────────────────────────────────────────────────────────────────────────
// Ingresos por billetera (para el menú lateral de Administración Financiera).
//
// Un pago pasa por dos estados, y se fecha distinto en cada uno:
//   • EN COLA (aún sin emparejar) → figura en su día de INGRESO (payment.fechaPago).
//   • EMPAREJADO (manual o auto)  → sale de la cola y pasa a figurar en el día del
//     EMPAREJAMIENTO (registro_log.ts). Su línea "en cola" del día de ingreso
//     desaparece sola, porque el pago ya no está en unmatchedPayments.
// Consecuencia buscada: un pago que ingresó ANTES del corte pero se empareja
// después SÍ cuenta, porque su fecha efectiva (el match) es ≥ corte.
//
// Los pagos marcados "No es de tiendas" (externallyMarkedPayments) se EXCLUYEN
// de la liquidación: no suman al total ni aparecen en el extracto.
//
// Corte: igual que las tiendas, desde BALANCE_CUTOFF.
//
// Fuente derivada, sin tabla nueva:
//   • Emparejados    → tabla registro_log (filtrado por ts ≥ corte).
//   • No emparejados → cola unmatchedPayments de criptoblue:state.
// En teoría un pago está emparejado O en la cola, nunca en las dos. En la práctica
// se vieron pagos emparejados que quedaron igual en la cola (se contaban dos veces),
// así que la cola se deduplica contra los ids de registro_log: manda el registro.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, kvGet, loadHotState } from './storage'
import { PAYMENT_SOURCE_TO_WALLET, PAYMENT_SOURCE_NAMES, WALLETS, BALANCE_CUTOFF } from './config'
import { getComisiones, comisionBilletera } from './comisiones'
import { sumRefundsByWallet, getRefundsDeWallet } from './reembolsos'

const OCULTAS_KEY = 'criptoblue:billeteras-ocultas'
const EXTRACTO_LIMIT = 200
const MATCHED_ACTIONS = ['auto_paid', 'manual_paid']

export interface IngresoBilletera {
  wallet: string
  totalArs: number          // NETO (comisión y reembolsos ya descontados)
  cantidad: number
  comisionArs: number       // comisión cobrada en ARS (positivo)
  comisionPct: number       // porcentaje aplicado (ej. 1)
  reembolsosArs: number     // total reembolsado desde esta billetera (positivo)
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

export interface DetalleBilletera {
  wallet: string
  totalArs: number          // NETO acumulado desde el corte (comisión y reembolsos descontados)
  cantidad: number
  comisionArs: number       // comisión total ARS
  comisionPct: number
  reembolsosArs: number     // total reembolsado desde esta billetera (positivo)
  reembolsos: ReembolsoBilletera[]  // detalle de los reembolsos (misma info que a la tienda)
  totalDia?: number         // subtotal (bruto) del día seleccionado
  cantidadDia?: number
  pagos: PagoBilletera[]    // del día seleccionado, o todos si no se pidió día
}

interface Ingreso {
  source: string
  monto: number
  fecha: string
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

// Pagos EMPAREJADOS, fechados por el DÍA DEL EMPAREJAMIENTO (`ts`), no por el de
// ingreso. Al emparejarse (manual o auto) el pago sale de la cola y pasa a figurar
// en el día del match. Por eso un pago que ingresó antes del corte pero se emparejó
// después SÍ cuenta: su fecha efectiva (el match) es ≥ corte.
// El filtro por corte lo hace el SQL sobre `ts` (indexado) — no hace falta refinar.
async function ingresosEmparejadosDesdeCorte(): Promise<Ingreso[]> {
  const c = getClient()
  const cutoffISO = BALANCE_CUTOFF.toISOString()
  const out: Ingreso[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (c.from('registro_log') as any)
      .select('amount, ts, source:payment->>source, monto:payment->>monto, titular:payment->>nombrePagador')
      .eq('hidden', false)
      .in('action', MATCHED_ACTIONS)
      .gte('ts', cutoffISO)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`ingresosEmparejadosDesdeCorte falló: ${error.message} [${error.code}]`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      if (!r.source || !r.ts) continue
      out.push({
        source: r.source,
        monto: Number(r.monto ?? r.amount) || 0,
        fecha: r.ts,              // día del emparejamiento
        titular: r.titular || '',
        estado: 'emparejado',
      })
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Pagos EN COLA (no emparejados) que ingresaron desde el corte, excluyendo los
// marcados "No es de tiendas" y los que YA están emparejados en el registro
// (quedaron en la cola por una inconsistencia: se contarían dos veces).
// labelSet opcional acota a una billetera.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ingresosEnColaDesdeCorte(hot: any, emparejadosIds: Set<string>, labelSet?: Set<string>): Ingreso[] {
  const cutoffMs = BALANCE_CUTOFF.getTime()
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
    if ((new Date(fecha).getTime() || 0) < cutoffMs) continue
    out.push({
      source: p.source,
      monto: Number(p.monto) || 0,
      fecha,
      titular: p.nombrePagador || '',
      estado: 'en_cola',
    })
  }
  return out
}

// Total por billetera (para los ítems del menú). Muestra TODAS las billeteras
// (como las tiendas, aunque el saldo desde el corte sea 0), salvo las ocultas.
export async function getIngresosBilleteras(): Promise<IngresoBilletera[]> {
  const [emparejados, hot, ocultas, cfg, reembolsosPorWallet, yaEmparejados] = await Promise.all([
    ingresosEmparejadosDesdeCorte(),
    loadHotState(),
    getBilleterasOcultas(),
    getComisiones(),
    sumRefundsByWallet(),
    idsEmparejados(),
  ])
  const cola = ingresosEnColaDesdeCorte(hot, yaEmparejados)

  // Arranca todas las billeteras en 0 → siempre aparecen, con su saldo de hoy.
  const acc = new Map<string, { totalArs: number; cantidad: number }>()
  for (const w of WALLETS) acc.set(w, { totalArs: 0, cantidad: 0 })
  const sumar = (wallet: string | null, monto: number) => {
    if (!wallet) return
    const cur = acc.get(wallet) ?? { totalArs: 0, cantidad: 0 }
    cur.totalArs += monto
    cur.cantidad += 1
    acc.set(wallet, cur)
  }
  for (const m of emparejados) sumar(resolveWallet(m.source), m.monto)
  for (const m of cola) sumar(resolveWallet(m.source), m.monto)

  const ocultasSet = new Set(ocultas)
  return [...acc.entries()]
    .filter(([wallet]) => !ocultasSet.has(wallet))
    .map(([wallet, v]) => {
      const pct = comisionBilletera(cfg, wallet)
      const comisionArs = v.totalArs * pct / 100
      const reembolsosArs = reembolsosPorWallet[wallet] ?? 0
      // El saldo baja por la comisión (nuestra) y por los reembolsos (dinero devuelto).
      return { wallet, totalArs: v.totalArs - comisionArs - reembolsosArs, cantidad: v.cantidad, comisionArs, comisionPct: pct, reembolsosArs }
    })
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
}

// Detalle de una billetera: total acumulado desde el corte + extracto de pagos.
// Si se pasa diaART ('YYYY-MM-DD'), el extracto se acota a ese día (ART) y se
// devuelve además el subtotal del día. El total acumulado no cambia por el día.
export async function getIngresosBilletera(wallet: string, diaART?: string): Promise<DetalleBilletera> {
  const cfg = await getComisiones()
  const pct = comisionBilletera(cfg, wallet)
  const labels = sourceLabelsDeBilletera(wallet)
  if (labels.length === 0) return { wallet, totalArs: 0, cantidad: 0, comisionArs: 0, comisionPct: pct, reembolsosArs: 0, reembolsos: [], pagos: [] }
  const labelSet = new Set(labels)

  const [emparejados, hot, refunds, yaEmparejados] = await Promise.all([
    ingresosEmparejadosDesdeCorte(), loadHotState(), getRefundsDeWallet(wallet), idsEmparejados(),
  ])
  const ingresos = [
    ...emparejados.filter(m => labelSet.has(m.source)),
    ...ingresosEnColaDesdeCorte(hot, yaEmparejados, labelSet),
  ]

  // Total acumulado (bruto) desde el corte → comisión → reembolsos → neto.
  let totalArsBruto = 0
  for (const m of ingresos) totalArsBruto += m.monto
  const comisionArs = totalArsBruto * pct / 100
  const reembolsosArs = refunds.reduce((s, r) => s + r.monto, 0)

  // Filtro por día (ART) para el extracto.
  let visibles = ingresos
  let totalDia: number | undefined
  let cantidadDia: number | undefined
  if (diaART && /^\d{4}-\d{2}-\d{2}$/.test(diaART)) {
    const desde = new Date(`${diaART}T00:00:00-03:00`).getTime()
    const hasta = desde + 24 * 60 * 60 * 1000
    visibles = ingresos.filter(m => {
      const t = new Date(m.fecha).getTime() || 0
      return t >= desde && t < hasta
    })
    totalDia = visibles.reduce((s, m) => s + m.monto, 0)
    cantidadDia = visibles.length
  }

  visibles.sort((a, b) => (new Date(b.fecha).getTime() || 0) - (new Date(a.fecha).getTime() || 0))

  return {
    wallet,
    totalArs: totalArsBruto - comisionArs - reembolsosArs,  // NETO (comisión + reembolsos)
    cantidad: ingresos.length,
    comisionArs, comisionPct: pct,
    reembolsosArs,
    reembolsos: refunds.map(r => ({ orderNumber: r.orderNumber, monto: r.monto, seq: r.seq, fecha: r.createdAt })),
    totalDia,
    cantidadDia,
    pagos: visibles.slice(0, EXTRACTO_LIMIT).map(m => ({
      fecha: m.fecha,
      titular: m.titular,
      monto: m.monto,
      comision: m.monto * pct / 100,
      estado: m.estado,
    })),
  }
}
