// Descarta ("no es de tiendas") un pago de una billetera que NO empareja órdenes
// —Bitso FluoGames, LB CriptoBlue— o lo vuelve a poner.
//
// Por qué hace falta un script: esos pagos no pasan por la cola, se asientan derecho en
// registro_log con action 'pago_billetera'. Como nunca aparecen en el área general, no
// hay botón de "No es de tiendas" que apretarles. El equivalente es ocultar su fila:
// hidden = true los saca del extracto, del saldo y de las métricas, y es REVERSIBLE
// (no borra nada). registrarPagoSoloBilletera() consulta las filas ocultas, así que el
// cron no los vuelve a traer.
//
//   node scripts/descartar-pago-billetera.mjs <unidad> <mpPaymentId>              → ENSAYO
//   node scripts/descartar-pago-billetera.mjs <unidad> <mpPaymentId> --aplicar    → oculta
//   node scripts/descartar-pago-billetera.mjs <unidad> <mpPaymentId> --revertir --aplicar
//
// Ejemplo:
//   node scripts/descartar-pago-billetera.mjs ms bitso-3901332a_447b_43f6_9720_8fa4d36d30ed

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const [unidad, mpPaymentId] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const aplicar = process.argv.includes('--aplicar')
const revertir = process.argv.includes('--revertir')

if (!unidad || !mpPaymentId) {
  console.error('Uso: node scripts/descartar-pago-billetera.mjs <unidad> <mpPaymentId> [--revertir] [--aplicar]')
  process.exit(1)
}
if (!['criptoblue', 'ms'].includes(unidad)) {
  console.error(`Unidad inválida: "${unidad}". Tiene que ser criptoblue o ms.`)
  process.exit(1)
}

const { data: filas, error } = await s.from('registro_log')
  .select('id, unidad, action, amount, ts, hidden, store_id, order_number, payment')
  .eq('unidad', unidad)
  .eq('mp_payment_id', mpPaymentId)
if (error) throw new Error(error.message)

if (!filas?.length) {
  console.error(`No hay ninguna fila con mp_payment_id="${mpPaymentId}" en la unidad ${unidad}.`)
  process.exit(1)
}

// Guarda: este script es SOLO para pagos de billetera. Un pago emparejado a una orden
// tiene tienda y saldo asociados; ocultarlo por acá dejaría el balance de la tienda
// descuadrado sin avisar.
const noSonDeBilletera = filas.filter(f => f.action !== 'pago_billetera')
if (noSonDeBilletera.length) {
  console.error('ABORTA: alguna fila no es un pago de billetera (action ≠ pago_billetera).')
  for (const f of noSonDeBilletera) console.error(`   id ${f.id} · action ${f.action} · tienda ${f.store_id} · orden ${f.order_number}`)
  console.error('Esos pagos se corrigen desde la app, no con este script.')
  process.exit(1)
}

const objetivo = !revertir
console.log(`${revertir ? 'RESTAURAR' : 'DESCARTAR'} en unidad "${unidad}":\n`)
let aCambiar = 0
for (const f of filas) {
  const p = f.payment ?? {}
  console.log(`   id ${f.id} · $${f.amount} · ${p.nombrePagador || '(sin titular)'} · ${f.ts}`)
  console.log(`      source ${p.source ?? '—'} · hidden ${f.hidden} → ${objetivo}`)
  if (f.hidden !== objetivo) aCambiar++
}

if (aCambiar === 0) {
  console.log(`\nNada que hacer: ya está${filas.length > 1 ? 'n' : ''} en hidden=${objetivo}.`)
  process.exit(0)
}

if (!aplicar) {
  console.log(`\n${aCambiar} fila(s) a cambiar. ENSAYO — corré con --aplicar para escribir.`)
  process.exit(0)
}

const { error: upErr } = await s.from('registro_log')
  .update({ hidden: objetivo })
  .eq('unidad', unidad)
  .eq('mp_payment_id', mpPaymentId)
  .eq('action', 'pago_billetera')
if (upErr) throw new Error(upErr.message)

console.log(`\n✓ ${aCambiar} fila(s) actualizada(s) a hidden=${objetivo}.`)
console.log(revertir
  ? 'El pago vuelve a contar en la billetera.'
  : 'El pago sale del extracto, del saldo y de las métricas. El cron no lo vuelve a traer.')
