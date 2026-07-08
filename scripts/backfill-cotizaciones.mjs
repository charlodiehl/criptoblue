// Completa la cotización USDT de los movimientos que quedaron 'pendiente'
// (creados antes de conectar la API de cotización).
//
// Requiere que lib/cotizacion.ts YA esté conectada a la API real — este script
// replica su contrato: define abajo getUsdtRate con la misma lógica.
// Correr con: node scripts/backfill-cotizaciones.mjs [--dry]

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// Misma lógica que lib/cotizacion.ts: precio de VENTA de Binance P2P (bid) + 0,75%.
// (Este archivo es .mjs y no puede importar el .ts directamente → se replica.)
const MARGEN_VENTA = 0.0075
async function getUsdtRate() {
  try {
    const res = await fetch('https://criptoya.com/api/binancep2p/USDT/ARS/1', { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    const bid = Number(data?.bid)
    return Number.isFinite(bid) && bid > 0 ? bid * (1 + MARGEN_VENTA) : null
  } catch {
    return null
  }
}

const dry = process.argv.includes('--dry')

const { data: pendientes, error } = await supabase
  .from('balance_movements')
  .select('id, store_id, fecha, ars, tipo')
  .eq('rate_source', 'pendiente')
  .order('fecha', { ascending: true })
if (error) throw new Error(error.message)

console.log(`Movimientos con cotización pendiente: ${pendientes.length}${dry ? ' (dry-run, no escribe)' : ''}`)

// La cotización es la misma para todas las órdenes (la actual) → se trae una vez.
const rate = await getUsdtRate()
if (!rate) { console.error('No se pudo obtener la cotización de la API. Reintentá más tarde.'); process.exit(1) }
console.log(`Cotización actual (Binance P2P +0,5%): ${rate.toFixed(2)} ARS/USDT`)

let ok = 0
for (const m of pendientes) {
  const usdt = Number(m.ars) / rate
  console.log(`  #${m.id} ${m.fecha} ars=${m.ars} → usdt=${usdt.toFixed(2)}`)
  if (!dry) {
    const { error: uErr } = await supabase
      .from('balance_movements')
      .update({ usdt, usdt_rate: rate, rate_source: 'api' })
      .eq('id', m.id)
      .eq('rate_source', 'pendiente') // idempotencia: no pisar si otro proceso ya lo completó
    if (uErr) { console.error(`  ERROR #${m.id}: ${uErr.message}`); continue }
  }
  ok++
}
console.log(`Completados: ${ok}`)
