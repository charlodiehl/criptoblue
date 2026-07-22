// Backfill de ingresos al balance desde el registro.
//
// Crea un movimiento 'ingreso_orden' por cada orden ya pagada (registro_log) desde
// la fecha de corte (BALANCE_CUTOFF), para las que todavía no tengan movimiento.
// Usa la cotización ACTUAL (Binance P2P +0,75%) para todas. Idempotente: se puede
// re-correr sin duplicar (saltea las que ya tienen movimiento por ref_registro_id).
//
// Correr con: node scripts/backfill-ingresos-registro.mjs [--dry]

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// Debe coincidir con BALANCE_CUTOFF de lib/config.ts (9/7/2026 00:00 ART).
// Si se atrasa, este script recrea los ingresos que el corte dejó afuera.
const CUTOFF = '2026-07-09T03:00:00Z'
const MARGEN_VENTA = 0.0075
const PAGE = 1000
const dry = process.argv.includes('--dry')

async function getUsdtRate() {
  const res = await fetch('https://criptoya.com/api/binancep2p/usdt/ars/1', { signal: AbortSignal.timeout(8000) })  // minúsculas: CriptoYa da 500 en mayúsculas
  if (!res.ok) return null
  const data = await res.json()
  const bid = Number(data?.bid)
  return Number.isFinite(bid) && bid > 0 ? bid * (1 + MARGEN_VENTA) : null
}

const rate = await getUsdtRate()
if (!rate) { console.error('No se pudo obtener la cotización. Reintentá.'); process.exit(1) }
console.log(`Cotización actual: ${rate.toFixed(2)} ARS/USDT · corte: ${CUTOFF}${dry ? ' · DRY-RUN' : ''}`)

// 1) Órdenes pagadas desde el corte (paginado)
const orders = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase.from('registro_log')
    .select('id, ts, store_id, store_name, amount, order_number')
    .in('action', ['auto_paid', 'manual_paid'])
    .eq('hidden', false)
    .not('store_id', 'is', null)
    .gte('ts', CUTOFF)
    .order('id', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) throw new Error(error.message)
  orders.push(...(data || []))
  if (!data || data.length < PAGE) break
}
console.log(`Órdenes pagadas desde el corte: ${orders.length}`)

// 2) Movimientos ya existentes (idempotencia)
const yaCon = new Set()
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase.from('balance_movements')
    .select('ref_registro_id').not('ref_registro_id', 'is', null).range(from, from + PAGE - 1)
  if (error) throw new Error(error.message)
  for (const m of data || []) yaCon.add(m.ref_registro_id)
  if (!data || data.length < PAGE) break
}

// 3) Armar los movimientos que faltan
const nuevos = orders
  .filter(o => Number(o.amount) > 0 && !yaCon.has(o.id))
  .map(o => ({
    store_id: o.store_id,
    tipo: 'ingreso_orden',
    fecha: o.ts,
    ars: Number(o.amount),
    usdt: Number(o.amount) / rate,
    usdt_rate: rate,
    rate_source: 'api',
    ref_registro_id: o.id,
    descripcion: `Orden #${o.order_number || '—'} · ${o.store_name || ''} (backfill)`.trim(),
  }))

console.log(`Movimientos a crear: ${nuevos.length} (ya existían: ${orders.length - nuevos.length})`)

// Resumen por tienda
const porTienda = {}
for (const m of nuevos) porTienda[m.store_id] = (porTienda[m.store_id] || 0) + m.ars
console.log('Ingreso ARS por tienda:')
for (const [sid, ars] of Object.entries(porTienda).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sid}: $${ars.toLocaleString('es-AR')}`)
}

if (!dry && nuevos.length) {
  for (let i = 0; i < nuevos.length; i += 500) {
    const lote = nuevos.slice(i, i + 500)
    const { error } = await supabase.from('balance_movements').insert(lote)
    if (error) throw new Error(error.message)
    console.log(`  insertados ${Math.min(i + 500, nuevos.length)}/${nuevos.length}`)
  }
}
console.log(dry ? 'DRY-RUN: no se insertó nada.' : 'Listo ✓')
