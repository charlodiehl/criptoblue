// Espeja en la unidad MS (billetera "LB CriptoBlue") los pagos de LB Finanzas que ya
// habían entrado a CriptoBlue antes de que el espejo existiera.
//
// El espejo lo escribe el webhook desde que se agregó, pero los pagos anteriores no lo
// tienen. Esto los completa: lee los pagos con source 'lbfinanzas' de la unidad
// criptoblue —los de la cola y los ya emparejados— y asienta su copia en el registro de
// la unidad ms con la acción 'pago_billetera' (sin tienda ni orden), igual que hace
// registrarPagoSoloBilletera().
//
// IDEMPOTENTE: el id del espejo se deriva del original (lbfinanzas-X → lbcriptoblue-X),
// así que correrlo dos veces no duplica nada.
//
//   node scripts/backfill-espejo-lbcriptoblue.mjs                    → ENSAYO
//   node scripts/backfill-espejo-lbcriptoblue.mjs --aplicar          → escribe
//   node scripts/backfill-espejo-lbcriptoblue.mjs --desde 2026-07-29 → otro piso (ART)

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
const iDesde = process.argv.indexOf('--desde')
const DIA_DESDE = iDesde >= 0 ? process.argv[iDesde + 1] : '2026-07-29'
const DESDE = new Date(`${DIA_DESDE}T00:00:00-03:00`)

// Los dos pagos que cargó la versión con el bug del monto: tenían el NETO ("Recibiste")
// en vez del bruto. El bruto correcto se verificó contra lo que informó el bot de
// Notificador para esos mismos depósitos. Se espeja el valor bueno, no el que quedó
// guardado: escribir a sabiendas un monto mal en el libro nuevo no tiene sentido.
const MONTO_CORREGIDO = {
  'lbfinanzas-19faec6dda4648db': 299999.01,   // Sergio David Carrasco (guardado: 298.949,01)
  'lbfinanzas-19faec9eec1434bf': 59415.00,    // Evangelina Mabel Leta (guardado: 59.207,05)
}

const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const art = t => new Date(new Date(t).getTime() - 3 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ')

// ── Origen: los pagos de LB Finanzas en la unidad criptoblue ─────────────────
const origen = []

// 1) Los que están en la cola (todavía sin emparejar, o marcados "no es de tiendas").
const { data: kv } = await s.from('kv_store').select('value').eq('key', 'criptoblue:state').maybeSingle()
for (const u of kv?.value?.unmatchedPayments ?? []) {
  const p = u.payment
  if (p?.source === 'lbfinanzas') origen.push(p)
}

// 2) Los ya emparejados con una orden, que viven en el registro.
let from = 0
for (;;) {
  const { data, error } = await s.from('registro_log')
    .select('payment').eq('unidad', 'criptoblue').eq('hidden', false).range(from, from + 999)
  if (error) throw new Error(error.message)
  for (const r of data) if (r.payment?.source === 'lbfinanzas') origen.push(r.payment)
  if (data.length < 1000) break
  from += 1000
}

// ── Qué falta espejar ───────────────────────────────────────────────────────
const { data: yaMs } = await s.from('registro_log')
  .select('mp_payment_id').eq('unidad', 'ms').eq('action', 'pago_billetera')
const yaEspejados = new Set((yaMs ?? []).map(r => r.mp_payment_id))

const candidatos = origen
  .filter(p => p.mpPaymentId && p.mpPaymentId.startsWith('lbfinanzas-'))
  .filter(p => p.fechaPago && new Date(p.fechaPago) >= DESDE)
  .sort((a, b) => (a.fechaPago < b.fechaPago ? -1 : 1))

const aEscribir = []
let yaEstaban = 0
for (const p of candidatos) {
  const idEspejo = 'lbcriptoblue-' + p.mpPaymentId.slice('lbfinanzas-'.length)
  if (yaEspejados.has(idEspejo)) { yaEstaban++; continue }
  const monto = MONTO_CORREGIDO[p.mpPaymentId] ?? Number(p.monto)
  aEscribir.push({ idEspejo, monto, corregido: p.mpPaymentId in MONTO_CORREGIDO, p })
}

console.log(`Piso: ${DIA_DESDE} 00:00 ART · pagos de LB Finanzas en criptoblue: ${origen.length}`)
console.log(`Dentro del piso: ${candidatos.length} · ya espejados: ${yaEstaban} · a escribir: ${aEscribir.length}`)
console.log('')
let total = 0
for (const x of aEscribir) {
  total += x.monto
  console.log('  ' + art(x.p.fechaPago), fmt(x.monto).padStart(15), (x.corregido ? '← CORREGIDO ' : '            '), (x.p.nombrePagador || '—').slice(0, 34))
}
console.log('')
console.log('Total a espejar:', fmt(total))

if (!aEscribir.length) { console.log('\nNada que hacer.'); process.exit(0) }
if (!aplicar) { console.log('\n(ENSAYO — corré con --aplicar para escribir)'); process.exit(0) }

// ── Escritura ───────────────────────────────────────────────────────────────
// Misma forma que entryToRow() + registrarPagoSoloBilletera() de la app: acción
// 'pago_billetera', sin tienda ni orden, y el payment con el source del espejo.
const filas = aEscribir.map(({ idEspejo, monto, p }) => ({
  ts: p.fechaPago,
  action: 'pago_billetera',
  source: null,
  amount: monto,
  mp_payment_id: idEspejo,
  payment_received_at: p.fechaPago,
  customer_name: p.nombrePagador || null,
  cuit_pagador: p.cuitPagador || null,
  hidden: false,
  unidad: 'ms',
  payment: { ...p, mpPaymentId: idEspejo, source: 'lbcriptoblue', monto, rawData: {} },
}))

let escritas = 0
for (let i = 0; i < filas.length; i += 100) {
  const lote = filas.slice(i, i + 100)
  const { error } = await s.from('registro_log').insert(lote)
  if (error) throw new Error(`insert falló en el lote ${i / 100 + 1}: ${error.message}`)
  escritas += lote.length
}
console.log(`\nEscritas ${escritas} filas en el registro de MS.`)

const { count } = await s.from('registro_log')
  .select('id', { count: 'exact', head: true }).eq('unidad', 'ms').eq('action', 'pago_billetera')
console.log('Total de pagos de billetera en MS ahora:', count)
