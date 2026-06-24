// Prueba end-to-end del webhook de Fiwind: postea un pago de prueba y verifica
// que quedó en la cola (unmatchedPayments). Con --limpiar lo elimina.
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/probar-webhook-fiwind.mjs           (postea + verifica)
//   node --env-file=.env.vercel-prod scripts/probar-webhook-fiwind.mjs --limpiar (elimina el de prueba)

import { createClient } from '@supabase/supabase-js'

const URL = 'https://criptoblue.vercel.app/api/fiwind/webhook'
const SECRET = process.env.FIWIND_WEBHOOK_SECRET
const ID_PRUEBA = 'PRUEBA-WEBHOOK-001'
const PAYMENT_ID = `fiwind-${ID_PRUEBA}`
const LIMPIAR = process.argv.includes('--limpiar')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const HOT_KEY = 'criptoblue:state'

async function getState() {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', HOT_KEY).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.value
}

if (LIMPIAR) {
  const state = await getState()
  const antes = state.unmatchedPayments.length
  state.unmatchedPayments = state.unmatchedPayments.filter(
    u => (u.payment?.mpPaymentId || u.mpPaymentId) !== PAYMENT_ID
  )
  await supabase.from('kv_store').upsert({ key: HOT_KEY, value: state, updated_at: new Date().toISOString() })
  console.log(`🧹 Pago de prueba eliminado de la cola: ${antes} → ${state.unmatchedPayments.length}`)
  process.exit(0)
}

// 1. Postear al webhook
const payload = {
  secret: SECRET,
  idCoelsa: ID_PRUEBA,
  monto: 1234.56,
  nombre: 'PRUEBA WEBHOOK FIWIND',
  fechaISO: new Date().toISOString(),
  cbuCvu: '0000000000000000000000',
  banco: 'Banco Prueba',
  raw: 'Pago de prueba del webhook — se puede borrar',
}

console.log('→ POST al webhook...')
const resp = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const json = await resp.json().catch(() => ({}))
console.log(`← HTTP ${resp.status}: ${JSON.stringify(json)}`)

// 2. Verificar que quedó en la cola
const state = await getState()
const cola = state?.unmatchedPayments ?? []
const encontrado = cola.find(u => (u.payment?.mpPaymentId || u.mpPaymentId) === PAYMENT_ID)

console.log('')
if (encontrado) {
  console.log('✅ El pago entró a la cola (unmatchedPayments):')
  console.log(`   nombre: ${encontrado.payment.nombrePagador}`)
  console.log(`   monto:  $${encontrado.payment.monto}`)
  console.log(`   fuente: ${encontrado.payment.source}`)
  console.log(`   id:     ${encontrado.payment.mpPaymentId}`)
  console.log(`\n👉 Refrescá la web y miralo en la pestaña "Sin coincidencia" o "Pagos".`)
  console.log(`   Para borrarlo: node --env-file=.env.vercel-prod scripts/probar-webhook-fiwind.mjs --limpiar`)
} else {
  console.log('✗ El pago NO aparece en la cola. Revisar la respuesta del webhook arriba.')
}
console.log(`\nTotal en cola ahora: ${cola.length}`)
