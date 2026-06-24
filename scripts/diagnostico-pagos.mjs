// Diagnóstico: de dónde vienen los pagos que se ven en la web.
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function contarPor(arr, getter) {
  const m = {}
  for (const x of arr) { const s = getter(x) || '(sin source)'; m[s] = (m[s] || 0) + 1 }
  return m
}

const state = (await supabase.from('kv_store').select('value').eq('key', 'criptoblue:state').maybeSingle()).data?.value
const unmatched = state?.unmatchedPayments ?? []
const recent = state?.recentMatches ?? []

console.log('=== criptoblue:state ===')
console.log('unmatchedPayments:', unmatched.length, '| sources:', JSON.stringify(contarPor(unmatched, u => u.payment?.source)))
console.log('recentMatches:    ', recent.length, '| sources:', JSON.stringify(contarPor(recent, m => m.payment?.source)))

const { count: regTotal } = await supabase.from('registro_log').select('id', { count: 'exact', head: true })
const cutoff48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
const { data: regRecent, count: regRecentCount } = await supabase
  .from('registro_log')
  .select('ts,action,source,amount,customer_name,cuit_pagador,mp_payment_id,payment', { count: 'exact' })
  .gte('ts', cutoff48)
  .order('ts', { ascending: false })
  .limit(8)

console.log('\n=== registro_log ===')
console.log('total filas:        ', regTotal)
console.log('últimas 48hs:       ', regRecentCount)
console.log('\nEjemplos recientes (ts | action | source | payment.source | mp_payment_id | $monto | nombre):')
for (const r of regRecent ?? []) {
  console.log(` - ${r.ts} | ${r.action} | ${r.source} | ${r.payment?.source} | ${r.mp_payment_id} | $${r.amount} | ${r.customer_name}`)
}
