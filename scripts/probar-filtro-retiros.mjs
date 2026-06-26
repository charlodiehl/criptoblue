// Verifica la capa 3 del webhook: manda un retiro y un depósito de prueba y
// confirma que el retiro se rechaza y el depósito entra. Limpia las pruebas.
//
// Uso: node --env-file=.env.vercel-prod scripts/probar-filtro-retiros.mjs

import { createClient } from '@supabase/supabase-js'

const SECRET = process.env.FIWIND_WEBHOOK_SECRET
const URL = 'https://criptoblue.vercel.app/api/fiwind/webhook'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const post = (b) =>
  fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then(r => r.json()).then(j => JSON.stringify(j))

const base = { secret: SECRET, monto: 9999, nombre: 'TEST', fechaISO: new Date().toISOString() }

console.log('RETIRO   (operacion=Retiro)   →', await post({ ...base, idCoelsa: 'TEST-RETIRO-001', operacion: 'Retiro' }))
console.log('DEPOSITO (operacion=Depósito) →', await post({ ...base, idCoelsa: 'TEST-DEPOSITO-001', operacion: 'Depósito' }))

const { data } = await supabase.from('kv_store').select('value').eq('key', 'criptoblue:state').maybeSingle()
const st = data.value
const ids = (st.unmatchedPayments || []).map(u => u.payment && u.payment.mpPaymentId)
console.log('')
console.log('¿Retiro entró a la cola?    ', ids.includes('fiwind-TEST-RETIRO-001'), '(esperado: false)')
console.log('¿Depósito entró a la cola?  ', ids.includes('fiwind-TEST-DEPOSITO-001'), '(esperado: true)')

st.unmatchedPayments = (st.unmatchedPayments || []).filter(u => !(u.payment && (u.payment.mpPaymentId || '').startsWith('fiwind-TEST-')))
await supabase.from('kv_store').upsert({ key: 'criptoblue:state', value: st, updated_at: new Date().toISOString() })
console.log('\n🧹 Pruebas limpiadas de la cola')
