/**
 * Script de reconciliación de pagos MP vs estado en Supabase
 *
 * Lógica:
 * - Trae todos los pagos aprobados de MP desde el HARD_CUTOFF
 * - Compara con el estado en Supabase
 * - Restaura pagos que desaparecieron por el bug de "No es de tiendas"
 *   (estaban en externallyMarkedPayments pero no en unmatchedPayments)
 * - Agrega pagos totalmente ausentes del estado
 * - NO toca pagos que ya están correctamente marcados en matchLog
 *
 * Uso: node scripts/reconcile-payments.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Cargar variables de entorno desde .env.local
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const MP_ACCESS_TOKEN = process.env.CRIPTOBLUE_MP_ACCESS_TOKEN
// 25/03/2026 15:30 ART → 18:30 UTC
const HARD_CUTOFF = new Date('2026-03-25T18:30:00.000Z')
const STATE_KEY = 'criptoblue:state'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MP_ACCESS_TOKEN) {
  console.error('❌ Faltan variables de entorno')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadState() {
  const { data } = await supabase.from('kv_store').select('value').eq('key', STATE_KEY).single()
  return data?.value ?? null
}

async function saveState(state) {
  await supabase.from('kv_store').upsert({ key: STATE_KEY, value: state, updated_at: new Date().toISOString() })
}

function normalizePayment(raw) {
  const OWNER_EMAIL = 'compubairestore@gmail.com'
  const OWNER_CUIT = '20190997252'
  const firstName = raw.payer?.first_name || ''
  const lastName = raw.payer?.last_name || ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const collectorEmail = raw.collector?.email || ''
  const payerEmail = raw.payer?.email || ''
  const payerCuit = raw.payer?.identification?.number || ''
  const emailPagador = (payerEmail && payerEmail !== collectorEmail && payerEmail !== OWNER_EMAIL) ? payerEmail : ''
  return {
    mpPaymentId: String(raw.id),
    monto: raw.transaction_amount,
    nombrePagador: fullName,
    emailPagador,
    cuitPagador: (payerCuit && payerCuit !== OWNER_CUIT) ? payerCuit : '',
    referencia: raw.external_reference || '',
    operationId: raw.order?.id ? String(raw.order.id) : '',
    metodoPago: `${raw.payment_method_id || ''} / ${raw.payment_type_id || ''}`,
    fechaPago: raw.date_approved || raw.date_created || '',
    status: raw.status || '',
    source: 'mercadopago',
  }
}

async function fetchAllMPPayments() {
  const payments = []
  let offset = 0
  const limit = 50

  console.log(`\n📡 Trayendo pagos de MP desde ${HARD_CUTOFF.toISOString()}...`)

  while (true) {
    const url = new URL('https://api.mercadopago.com/v1/payments/search')
    url.searchParams.set('sort', 'date_approved')
    url.searchParams.set('criteria', 'desc')
    url.searchParams.set('range', 'date_approved')
    url.searchParams.set('begin_date', HARD_CUTOFF.toISOString())
    url.searchParams.set('end_date', new Date().toISOString())
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('status', 'approved')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      console.error('❌ Error MP:', res.status, await res.text())
      break
    }

    const data = await res.json()
    const results = data.results || []
    if (results.length === 0) break

    payments.push(...results.map(normalizePayment))
    offset += results.length
    console.log(`   → ${offset} / ${data.paging?.total} pagos`)

    if (offset >= data.paging?.total) break
    await new Promise(r => setTimeout(r, 500))
  }

  return payments
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 Iniciando reconciliación de pagos...\n')

  // 1. Cargar estado actual
  const state = await loadState()
  if (!state) { console.error('❌ No se pudo cargar el estado'); process.exit(1) }

  const unmatchedPayments = state.unmatchedPayments || []
  const processedPayments = state.processedPayments || []
  const matchLog = state.matchLog || []
  const externallyMarkedPayments = state.externallyMarkedPayments || []

  console.log(`📊 Estado actual:`)
  console.log(`   processedPayments: ${processedPayments.length}`)
  console.log(`   unmatchedPayments: ${unmatchedPayments.length}`)
  console.log(`   matchLog entries:  ${matchLog.length}`)
  console.log(`   externallyMarked:  ${externallyMarkedPayments.length}`)

  // 2. IDs ya en el estado
  const unmatchedIds = new Set(unmatchedPayments.map(u => u.payment?.mpPaymentId || u.mpPaymentId))
  const matchLogIds = new Set(
    matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean)
  )
  // Soportar tanto string[] (formato viejo) como { id, markedAt }[] (formato nuevo)
  const externalIds = new Set(externallyMarkedPayments.map(e => typeof e === 'string' ? e : e.id))

  // 3. Traer pagos de MP
  const mpPayments = await fetchAllMPPayments()
  console.log(`\n✅ MP devolvió ${mpPayments.length} pagos aprobados\n`)

  // 4. Analizar cuáles faltan
  let restored = 0
  let skipped = 0
  let added = 0
  const processedSet = new Set(processedPayments)

  for (const payment of mpPayments) {
    const id = payment.mpPaymentId

    // Ya está en unmatchedPayments → ok
    if (unmatchedIds.has(id)) { skipped++; continue }

    // Ya está en matchLog como pagado/descartado → no tocar
    if (matchLogIds.has(id)) {
      console.log(`   ✓ [matchLog]    ${id} — ${payment.monto} — ${payment.nombrePagador || 'sin nombre'}`)
      skipped++
      continue
    }

    // Estaba marcado como externo pero desapareció (bug) → restaurar con badge amarillo
    if (externalIds.has(id)) {
      console.log(`   🔄 [restaurar]  ${id} — ${payment.monto} — ${payment.nombrePagador || 'sin nombre'}`)
      unmatchedPayments.push({
        payment,
        timestamp: payment.fechaPago || new Date().toISOString(),
        mpPaymentId: id,
      })
      restored++
      continue
    }

    // Totalmente ausente del estado → agregar como nuevo
    console.log(`   ➕ [agregar]    ${id} — ${payment.monto} — ${payment.nombrePagador || 'sin nombre'}`)
    unmatchedPayments.push({
      payment,
      timestamp: payment.fechaPago || new Date().toISOString(),
      mpPaymentId: id,
    })
    processedSet.add(id)
    added++
  }

  console.log(`\n📋 Resultado:`)
  console.log(`   ✓ Ya estaban correctos: ${skipped}`)
  console.log(`   🔄 Restaurados (bug):   ${restored}`)
  console.log(`   ➕ Agregados nuevos:    ${added}`)

  if (restored === 0 && added === 0) {
    console.log('\n✅ Todo está completo, no hay nada que restaurar.')
    return
  }

  // 5. Guardar estado actualizado
  state.unmatchedPayments = unmatchedPayments
  state.processedPayments = Array.from(processedSet)

  console.log(`\n💾 Guardando estado actualizado...`)
  await saveState(state)
  console.log(`✅ Listo. ${restored + added} pagos restaurados/agregados.`)
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
