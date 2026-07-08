// ─────────────────────────────────────────────────────────────────────────────
// Cotización del USDT en ARS.
//
// Fuente: precio de VENTA de Binance P2P (campo `bid`) vía CriptoYa, + 0,5%.
// Ese resultado son los ARS que vale 1 USDT → para valuar una orden en USDT:
//   usdt = ars / rate
// Se usa la MISMA cotización para todas las tiendas y todas las órdenes.
// ─────────────────────────────────────────────────────────────────────────────

const URL = 'https://criptoya.com/api/binancep2p/USDT/ARS/1'

// Margen sobre el precio de venta (bid) de Binance P2P: +0,75%.
const MARGEN_VENTA = 0.0075

// Cache en memoria: evita golpear la API en cada orden cuando el cron empareja
// un lote. La cotización no se mueve en 2 minutos → alcanza de sobra.
const CACHE_TTL_MS = 120_000
let _cache: { rate: number; at: number } | null = null

// ARS por 1 USDT = bid (Binance P2P) × (1 + 0,5%). null si la API falla y no hay
// un valor previo en cache (en ese caso la orden queda 'pendiente' y la completa
// el backfill de /api/cron/cotizaciones).
export async function getUsdtRate(): Promise<number | null> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.rate
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(URL, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    if (!res.ok) return _cache?.rate ?? null
    const data = await res.json()
    const bid = Number(data?.bid)
    if (!Number.isFinite(bid) || bid <= 0) return _cache?.rate ?? null
    const rate = bid * (1 + MARGEN_VENTA)
    _cache = { rate, at: Date.now() }
    return rate
  } catch {
    // API caída / timeout → usar la última cotización conocida si la hay.
    return _cache?.rate ?? null
  }
}
