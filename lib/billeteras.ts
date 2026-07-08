// ─────────────────────────────────────────────────────────────────────────────
// Ingresos por billetera (para el menú lateral de Administración Financiera).
//
// A diferencia del balance de tienda (que se acredita AL EMPAREJAR), acá se
// cuenta el INGRESO del pago: los pagos que ENTRAN por una billetera, por su
// fecha de ingreso (payment.fechaPago), estén emparejados o no.
//
// Corte: igual que las tiendas, se cuenta desde BALANCE_CUTOFF (hoy 00:00 ART).
// El filtro es por FECHA DE INGRESO del pago (no la de emparejamiento): un pago
// que ingresó antes del corte pero se empareja después NO cuenta.
//
// Fuente derivada, sin tabla nueva:
//   • Emparejados  → tabla registro_log (prefiltrado por ts ≥ corte —un pago se
//     empareja después de ingresar— y refinado por fecha de ingreso en JS).
//   • No emparejados → cola unmatchedPayments de criptoblue:state, EXCLUYENDO los
//     marcados "No es de tiendas" (externallyMarkedPayments).
// Un pago está emparejado O en la cola, nunca ambos → no hay doble conteo.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, kvGet, loadHotState } from './storage'
import { PAYMENT_SOURCE_TO_WALLET, PAYMENT_SOURCE_NAMES, WALLETS, BALANCE_CUTOFF } from './config'

const OCULTAS_KEY = 'criptoblue:billeteras-ocultas'
const EXTRACTO_LIMIT = 200
const MATCHED_ACTIONS = ['auto_paid', 'manual_paid']

export interface IngresoBilletera {
  wallet: string
  totalArs: number
  cantidad: number
}

export interface PagoBilletera {
  fecha: string
  titular: string
  monto: number
  estado: 'emparejado' | 'en_cola'
}

export interface DetalleBilletera {
  wallet: string
  totalArs: number          // acumulado desde el corte (no cambia al elegir un día)
  cantidad: number
  totalDia?: number         // subtotal del día seleccionado (si se pidió un día)
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
function resolveWallet(source?: string | null): string | null {
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

// Pagos EMPAREJADOS que ingresaron desde el corte. Se prefiltra por ts ≥ corte
// (indexado; como un pago se empareja después de ingresar, entry ≥ corte ⊆ ts ≥
// corte) y se refina por fecha de ingreso en JS. Selección liviana (paths JSONB).
async function ingresosEmparejadosDesdeCorte(): Promise<Ingreso[]> {
  const c = getClient()
  const cutoffMs = BALANCE_CUTOFF.getTime()
  const cutoffISO = BALANCE_CUTOFF.toISOString()
  const out: Ingreso[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (c.from('registro_log') as any)
      .select('amount, payment_received_at, ts, source:payment->>source, monto:payment->>monto, titular:payment->>nombrePagador, fpago:payment->>fechaPago')
      .eq('hidden', false)
      .in('action', MATCHED_ACTIONS)
      .gte('ts', cutoffISO)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`ingresosEmparejadosDesdeCorte falló: ${error.message} [${error.code}]`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      if (!r.source) continue
      const fecha = r.fpago || r.payment_received_at || r.ts || ''
      if ((new Date(fecha).getTime() || 0) < cutoffMs) continue
      out.push({
        source: r.source,
        monto: Number(r.monto ?? r.amount) || 0,
        fecha,
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
// marcados "No es de tiendas". labelSet opcional acota a una billetera.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ingresosEnColaDesdeCorte(hot: any, labelSet?: Set<string>): Ingreso[] {
  const cutoffMs = BALANCE_CUTOFF.getTime()
  const externos = new Set((hot.externallyMarkedPayments ?? []).map((e: { id: string }) => e.id))
  const out: Ingreso[] = []
  for (const u of hot.unmatchedPayments ?? []) {
    const p = u.payment
    if (!p?.source) continue
    if (labelSet && !labelSet.has(p.source)) continue
    const id = u.mpPaymentId || p.mpPaymentId
    if (externos.has(id)) continue
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
  const [emparejados, hot, ocultas] = await Promise.all([
    ingresosEmparejadosDesdeCorte(),
    loadHotState(),
    getBilleterasOcultas(),
  ])
  const cola = ingresosEnColaDesdeCorte(hot)

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
    .map(([wallet, v]) => ({ wallet, totalArs: v.totalArs, cantidad: v.cantidad }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
}

// Detalle de una billetera: total acumulado desde el corte + extracto de pagos.
// Si se pasa diaART ('YYYY-MM-DD'), el extracto se acota a ese día (ART) y se
// devuelve además el subtotal del día. El total acumulado no cambia por el día.
export async function getIngresosBilletera(wallet: string, diaART?: string): Promise<DetalleBilletera> {
  const labels = sourceLabelsDeBilletera(wallet)
  if (labels.length === 0) return { wallet, totalArs: 0, cantidad: 0, pagos: [] }
  const labelSet = new Set(labels)

  const [emparejados, hot] = await Promise.all([ingresosEmparejadosDesdeCorte(), loadHotState()])
  const ingresos = [
    ...emparejados.filter(m => labelSet.has(m.source)),
    ...ingresosEnColaDesdeCorte(hot, labelSet),
  ]

  // Total acumulado desde el corte (todos los días).
  let totalArs = 0
  for (const m of ingresos) totalArs += m.monto

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
    totalArs,
    cantidad: ingresos.length,
    totalDia,
    cantidadDia,
    pagos: visibles.slice(0, EXTRACTO_LIMIT).map(m => ({
      fecha: m.fecha,
      titular: m.titular,
      monto: m.monto,
      estado: m.estado,
    })),
  }
}
