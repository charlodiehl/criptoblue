// Arreglo puntual de los duplicados de la billetera MS detectados el 30/7/2026.
//
// Tres pagos quedaron contados dos veces en la billetera MS (unidad criptoblue):
//
//   1. Ramona Susana Balmaceda $100.000 (29/7 14:28) — entró por el bot del
//      notificador (emparejado a Cacique #23139) y otra vez por el email de LB
//      Finanzas. La copia del email queda "No es de tiendas".
//   2. Roxana Zarate $59.415 (29/7 14:29) — mismo caso, los dos pendientes.
//      La copia del email queda "No es de tiendas".
//   3. Maria Fernanda Lascombes $59.415 (21/7 23:53) — se cargó A MANO un pago que
//      el bot ya había traído. El pago real (notificador-22217) quedó pendiente y el
//      manual quedó emparejado a Perla #88973.
//
// Para (1) y (2) se hace exactamente lo que hace /api/mark-payment-received: el pago
// se suma a externallyMarkedPayments y a processedPayments. NO se saca de la cola —
// el endpoint tampoco lo hace; el filtro por externallyMarked ya lo esconde en todos
// lados.
//
// Para (3) NO se borra ni se re-empareja: se le CAMBIA el pago a la fila del registro,
// del manual al real, y se saca el real de la cola. Es lo mínimo que hace falta y deja
// el saldo de la tienda intacto: mismo monto, misma orden, mismo movimiento de balance
// (id 3389, ARS 59.415 a 1604,56). Borrar y re-emparejar movería el ingreso al día de
// hoy y lo revaluaría a la cotización de hoy, cambiando el saldo de Perla sin motivo.
//
// Toma el mismo lock que usan los endpoints, porque /api/run reescribe el estado cada
// 5 minutos y un read-modify-write sin lock puede pisar pagos nuevos.
//
//   node scripts/fix-duplicados-ms-jul2026.mjs             → ENSAYO
//   node scripts/fix-duplicados-ms-jul2026.mjs --aplicar   → escribe

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const aplicar = process.argv.includes('--aplicar')
const U = 'criptoblue'
const HOLDER = 'fix-duplicados-ms-jul2026'

const DESCARTAR = ['lbfinanzas-19faeeb882f1d9d4', 'lbfinanzas-19faeecb721549ad']
const REGISTRO_MANUAL = 20310
const PAGO_REAL = 'notificador-22217'

const nowART = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
const kvGet = async key => (await s.from('kv_store').select('value').eq('key', key).maybeSingle()).data?.value
const kvSet = async (key, value) => {
  const { error } = await s.from('kv_store').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`kvSet ${key}: ${error.message}`)
}

// ── Verificación previa: nada se toca si el estado no es el esperado ──────────
const { data: reg } = await s.from('registro_log').select('*').eq('id', REGISTRO_MANUAL).maybeSingle()
if (!reg) throw new Error(`No existe la fila de registro ${REGISTRO_MANUAL}`)
if (reg.unidad !== U) throw new Error(`La fila ${REGISTRO_MANUAL} es de la unidad ${reg.unidad}, no de ${U}`)
if (reg.order_number !== '88973' || reg.store_id !== '5512981') {
  throw new Error(`La fila ${REGISTRO_MANUAL} no es la orden #88973 de Perla — ABORTA`)
}
if (!String(reg.mp_payment_id).startsWith('manual_')) {
  console.log(`La fila ${REGISTRO_MANUAL} ya apunta a ${reg.mp_payment_id} — el paso 3 ya estaba hecho.`)
}

const estado = await kvGet(`${U}:state`)
const cola = estado?.unmatchedPayments ?? []
const pagoReal = cola.find(u => (u.mpPaymentId || u.payment?.mpPaymentId) === PAGO_REAL)

console.log('══ ESTADO ACTUAL ══')
console.log(`   registro ${REGISTRO_MANUAL}: ${reg.mp_payment_id} · $${reg.amount} · ${reg.store_name} #${reg.order_number}`)
console.log(`   payment.source actual: ${reg.payment?.source} · titular ${reg.payment?.nombrePagador}`)
console.log(`   pago real en la cola: ${pagoReal ? 'sí' : 'NO (ya salió)'}`)
console.log(`   cola: ${cola.length} · externallyMarked: ${(estado?.externallyMarkedPayments ?? []).length}`)
for (const id of DESCARTAR) {
  const enCola = cola.some(u => (u.mpPaymentId || u.payment?.mpPaymentId) === id)
  const yaExterno = (estado?.externallyMarkedPayments ?? []).some(e => e.id === id)
  console.log(`   ${id}: en cola=${enCola} · ya descartado=${yaExterno}`)
}

if (pagoReal && Math.abs(Number(pagoReal.payment?.monto) - Number(reg.amount)) > 0.005) {
  throw new Error(`El pago real ($${pagoReal.payment?.monto}) no coincide con el registro ($${reg.amount}) — ABORTA`)
}

if (!aplicar) {
  console.log('\nENSAYO — nada se escribió. Corré con --aplicar.')
  process.exit(0)
}

// ── Lock, igual que los endpoints ────────────────────────────────────────────
const lockActual = await kvGet(`${U}:lock`)
if (lockActual?.acquiredAt && Date.now() - new Date(lockActual.acquiredAt).getTime() < 30_000) {
  console.error(`Hay un lock activo de "${lockActual.holder}". Esperá unos segundos y reintentá.`)
  process.exit(1)
}
const lockId = `${HOLDER}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
await kvSet(`${U}:lock`, { lockId, holder: HOLDER, acquiredAt: new Date().toISOString() })
if ((await kvGet(`${U}:lock`))?.lockId !== lockId) {
  console.error('Otro proceso tomó el lock. Reintentá.')
  process.exit(1)
}

try {
  // Se relee DENTRO del lock: entre el chequeo y acá pudo correr un ciclo.
  const st = await kvGet(`${U}:state`)
  st.unmatchedPayments ??= []
  st.externallyMarkedPayments ??= []

  // ── Pasos 1 y 2: descartar las dos copias del email ──
  for (const id of DESCARTAR) {
    if (!st.externallyMarkedPayments.some(e => e.id === id)) {
      st.externallyMarkedPayments.push({ id, markedAt: nowART() })
      console.log(`   ✓ descartado ${id}`)
    } else console.log(`   – ${id} ya estaba descartado`)
  }

  // ── Paso 3: el registro pasa a apuntar al pago real, y el real sale de la cola ──
  const idx = st.unmatchedPayments.findIndex(u => (u.mpPaymentId || u.payment?.mpPaymentId) === PAGO_REAL)
  const real = idx >= 0 ? st.unmatchedPayments[idx] : null
  if (real) {
    const { error } = await s.from('registro_log').update({
      mp_payment_id: PAGO_REAL,
      payment: real.payment,
      // La fecha real del pago la manda el bot; el manual la tenía redondeada al minuto.
      payment_received_at: new Date(real.payment.fechaPago).toISOString(),
    }).eq('id', REGISTRO_MANUAL)
    if (error) throw new Error(`update registro: ${error.message}`)
    st.unmatchedPayments.splice(idx, 1)
    console.log(`   ✓ registro ${REGISTRO_MANUAL} ahora apunta a ${PAGO_REAL}, y salió de la cola`)
  } else {
    console.log(`   – ${PAGO_REAL} no está en la cola: no se toca el registro`)
  }

  await kvSet(`${U}:state`, st)

  // processedPayments, igual que hace /api/mark-payment-received
  const proc = (await kvGet(`${U}:processed`)) ?? { processedPayments: [] }
  proc.processedPayments ??= []
  for (const id of [...DESCARTAR, ...(real ? [PAGO_REAL] : [])])
    if (!proc.processedPayments.includes(id)) proc.processedPayments.push(id)
  await kvSet(`${U}:processed`, proc)

  console.log('\n✓ Listo.')
} finally {
  const l = await kvGet(`${U}:lock`)
  if (l?.holder === HOLDER) await kvSet(`${U}:lock`, {})
}
