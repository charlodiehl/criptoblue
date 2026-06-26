// Elimina de la cola los "pagos" de Fiwind que en realidad son RETIROS ("Enviaste").
// El rawData se strippea al guardar el estado, así que NO se puede mirar el cuerpo:
// se identifican por el nombre de la TITULAR de la cuenta (los retiros van a su
// nombre; los depósitos vienen a nombre del cliente). Solo toca unmatchedPayments.
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/limpiar-retiros-fiwind.mjs --titular="Mileidy Andreina Infante Acacio"            (dry-run)
//   node --env-file=.env.vercel-prod scripts/limpiar-retiros-fiwind.mjs --titular="Mileidy Andreina Infante Acacio" --confirmar

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const CONFIRMAR = process.argv.includes('--confirmar')
const HOT_KEY = 'criptoblue:state'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data, error } = await supabase.from('kv_store').select('value').eq('key', HOT_KEY).maybeSingle()
if (error) { console.error('Error:', error.message); process.exit(1) }
const state = data.value
const unmatched = state.unmatchedPayments ?? []

const arg = process.argv.find(a => a.startsWith('--titular='))
const TITULAR = (arg ? arg.split('=').slice(1).join('=') : '').trim().toLowerCase()
if (!TITULAR) { console.error('❌ Falta --titular="Nombre de la titular"'); process.exit(1) }

// Es retiro de Fiwind si el pago está a nombre de la titular de la cuenta
// (los retiros/"Enviaste" van a su nombre; los depósitos vienen del cliente).
function esRetiroFiwind(u) {
  const p = u.payment
  if (!p || p.source !== 'fiwind') return false
  return (p.nombrePagador || '').trim().toLowerCase() === TITULAR
}

const retiros = unmatched.filter(esRetiroFiwind)
const conservar = unmatched.filter(u => !esRetiroFiwind(u))

console.log(`unmatchedPayments: ${unmatched.length}`)
console.log(`Retiros de Fiwind a eliminar: ${retiros.length}`)
for (const u of retiros) {
  console.log(`  - $${u.payment.monto} | ${u.payment.nombrePagador || 's/nombre'} | id ${u.payment.mpPaymentId}`)
}

if (!retiros.length) { console.log('\nNo hay retiros en la cola. Nada que hacer.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = `backup-retiros-${stamp}.json`
writeFileSync(backupFile, JSON.stringify(retiros, null, 2))
console.log(`\n💾 Backup: ${backupFile}`)

if (!CONFIRMAR) {
  console.log('\n(DRY-RUN) No se eliminó nada. Agregá --confirmar para ejecutar.')
  process.exit(0)
}

state.unmatchedPayments = conservar
const { error: upErr } = await supabase.from('kv_store').upsert({ key: HOT_KEY, value: state, updated_at: new Date().toISOString() })
if (upErr) { console.error('Error guardando:', upErr.message); process.exit(1) }
console.log(`\n✅ Eliminados ${retiros.length}. unmatchedPayments: ${unmatched.length} → ${conservar.length}`)
