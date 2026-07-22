// ─────────────────────────────────────────────────────────────────────────────
// Cotización del USDT en ARS.
//
// Fuente: precio de VENTA de Binance P2P (campo `bid`) vía CriptoYa.
// Ese precio son los ARS que vale 1 USDT → para valuar en USDT: usdt = ars / rate.
// Se usa la MISMA cotización de base para todas las tiendas y todas las órdenes.
//
// Dos variantes según el sentido del movimiento:
//   • getUsdtRate()        → precio de venta + 0,75%. Para los INGRESOS (órdenes que
//                            pagan las tiendas): ahí cobramos el margen.
//   • getUsdtRateSinMargen → precio de venta puro (+0%). Para los EGRESOS —reembolsos
//                            y pagos de transferencias—: no se cobra margen.
// ─────────────────────────────────────────────────────────────────────────────

// OJO: CriptoYa se volvió case-sensitive (jul 2026): el path con USDT/ARS en
// MAYÚSCULAS devuelve HTTP 500; en minúsculas responde OK. Mantener en minúsculas.
const URL = 'https://criptoya.com/api/binancep2p/usdt/ars/1'

// Margen sobre el precio de venta (bid) de Binance P2P que se cobra en los ingresos.
const MARGEN_VENTA = 0.0075

// Cache en memoria del bid crudo: evita golpear la API en cada orden cuando el cron
// empareja un lote. La cotización no se mueve en 2 minutos → alcanza de sobra.
// Se cachea el bid (no el rate) para derivar las dos variantes de una sola llamada.
const CACHE_TTL_MS = 120_000
let _cache: { bid: number; at: number } | null = null

// Precio de venta crudo (bid de Binance P2P). null si la API falla y no hay un valor
// previo en cache (en ese caso la orden queda 'pendiente' y la completa el backfill).
async function getBid(): Promise<number | null> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.bid
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(URL, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    if (!res.ok) return _cache?.bid ?? null
    const data = await res.json()
    const bid = Number(data?.bid)
    if (!Number.isFinite(bid) || bid <= 0) return _cache?.bid ?? null
    _cache = { bid, at: Date.now() }
    return bid
  } catch {
    // API caída / timeout → usar la última cotización conocida si la hay.
    return _cache?.bid ?? null
  }
}

// ARS por 1 USDT = precio de venta + 0,75%. Para los ingresos por órdenes.
export async function getUsdtRate(): Promise<number | null> {
  const bid = await getBid()
  return bid == null ? null : bid * (1 + MARGEN_VENTA)
}

// ARS por 1 USDT = precio de venta puro (sin el 0,75%). Para reembolsos y pagos.
export async function getUsdtRateSinMargen(): Promise<number | null> {
  return getBid()
}
