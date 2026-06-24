// Normaliza payment_received_at de todo el registro a UTC canónico (toISOString),
// poblando los que están en null desde payment.fechaPago (o ts como fallback).
// Necesario para que el orden por fecha del pago sea cronológico (la columna es
// texto: con formato uniforme, el orden alfabético = cronológico).
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/backfill-payment-received-at.mjs           (dry-run)
//   node --env-file=.env.vercel-prod scripts/backfill-payment-received-at.mjs --confirmar

import { createClient } from '@supabase/supabase-js'

const CONFIRMAR = process.argv.includes('--confirmar')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function toUTCISO(iso) {
  if (!iso) return iso
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toISOString()
}

const PAGE = 1000
let from = 0, total = 0, aCambiar = 0, actualizadas = 0
const ejemplos = []

for (;;) {
  const { data, error } = await supabase
    .from('registro_log')
    .select('id, ts, payment_received_at, payment')
    .order('ts', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) { console.error('Error leyendo:', error.message); process.exit(1) }
  if (!data.length) break

  for (const r of data) {
    total++
    const fechaPago = r.payment && r.payment.fechaPago
    const nuevo = toUTCISO(fechaPago || r.ts)
    if (nuevo && nuevo !== r.payment_received_at) {
      aCambiar++
      if (ejemplos.length < 5) ejemplos.push({ id: r.id, de: r.payment_received_at, a: nuevo })
      if (CONFIRMAR) {
        const { error: e } = await supabase.from('registro_log').update({ payment_received_at: nuevo }).eq('id', r.id)
        if (e) console.error('  err id', r.id, e.message)
        else actualizadas++
      }
    }
  }
  if (data.length < PAGE) break
  from += PAGE
}

console.log(`Total filas: ${total}`)
console.log(`A normalizar: ${aCambiar}`)
console.log('Ejemplos:')
for (const e of ejemplos) console.log(`  id ${e.id}: ${e.de} → ${e.a}`)
if (CONFIRMAR) console.log(`\n✅ Actualizadas: ${actualizadas}`)
else console.log('\n(DRY-RUN) No se cambió nada. Agregá --confirmar para ejecutar.')
