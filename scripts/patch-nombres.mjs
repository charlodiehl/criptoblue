/**
 * Agrega nombres a pagos "Sin nombre" en Supabase
 * Matching por monto exacto + hora en hora Argentina (UTC-3)
 *
 * Uso: node scripts/patch-nombres.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Cargar .env.local
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const HOT_KEY = 'criptoblue:state'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Nombres a aplicar ─────────────────────────────────────────────────────────
// { monto: número exacto, hora: "HH:MM" en hora Argentina, nombre: string }
const NAMES_TO_APPLY = [
  // Tanda 1 — 01/04
  { monto: 929548,  hora: '00:02', nombre: 'Andrea Sttefania Angulo Molina' },
  { monto: 55992,   hora: '00:01', nombre: 'Bustos, Macarena' },
  { monto: 55920,   hora: '00:01', nombre: 'Rita Maria De Los Angeles Degiovanni' },
  { monto: 79368,   hora: '23:59', nombre: 'Viotti Cecilia Giselle' },
  { monto: 55920,   hora: '23:56', nombre: 'Maria Celeste Valsecchi' },
  // Tanda 2 — 31/03 y 01/04
  { monto: 408500,  hora: '23:28', nombre: 'Andrea Sttefania Angulo Molina' },
  { monto: 55920,   hora: '23:25', nombre: 'Gisela Maria Balino Franco' },
  { monto: 48000,   hora: '23:19', nombre: 'Marina Cuello' },
  { monto: 47920,   hora: '22:08', nombre: 'Gutierrez Sandra Paola' },
  { monto: 95475,   hora: '22:00', nombre: 'Harfi Design' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function horaAR(fechaPago) {
  const d = new Date(fechaPago)
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

async function main() {
  console.log('🔄 Cargando estado desde Supabase...')
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', HOT_KEY).single()
  if (error || !data) {
    console.error('❌ No se pudo cargar el estado:', error?.message)
    process.exit(1)
  }

  const state = data.value
  const unmatched = state.unmatchedPayments || []

  console.log(`\n📊 unmatchedPayments en Supabase: ${unmatched.length}`)
  if (unmatched.length === 0) {
    console.log('⚠️  No hay pagos sin emparejar en el estado actual.')
    console.log('   (El estado puede estar vacío o los pagos ya expiraron)\n')
    return
  }

  // Mostrar todos los pagos actuales para inspección
  console.log('\n📋 Pagos sin emparejar actualmente:')
  for (const u of unmatched) {
    const p = u.payment
    const hora = p.fechaPago ? horaAR(p.fechaPago) : '??:??'
    console.log(`   $${p.monto} | ${hora} | "${p.nombrePagador || 'sin nombre'}" | ${p.mpPaymentId}`)
  }

  // Aplicar nombres
  console.log('\n✏️  Aplicando nombres...')
  let updated = 0

  for (const { monto, hora, nombre } of NAMES_TO_APPLY) {
    // Candidatos con el mismo monto
    const candidates = unmatched.filter(u => u.payment.monto === monto)

    if (candidates.length === 0) {
      console.log(`   ⚠️  No encontrado — $${monto} a las ${hora}`)
      continue
    }

    // Si hay más de uno con el mismo monto, desambiguar por hora
    const match = candidates.length === 1
      ? candidates[0]
      : candidates.find(u => horaAR(u.payment.fechaPago) === hora)

    if (!match) {
      console.log(`   ⚠️  Ambiguo — ${candidates.length} pagos de $${monto}, ninguno a las ${hora}`)
      continue
    }

    const antes = match.payment.nombrePagador || 'sin nombre'
    match.payment.nombrePagador = nombre
    // Persistir en paymentOverrides para que cycle.ts re-aplique el nombre
    // aunque vuelva a crear el pago desde MP con nombre vacío
    state.paymentOverrides = state.paymentOverrides || {}
    state.paymentOverrides[match.payment.mpPaymentId] = { nombrePagador: nombre }
    console.log(`   ✅ $${monto} ${hora} | "${antes}" → "${nombre}"`)
    updated++
  }

  if (updated === 0) {
    console.log('\n⚠️  No se actualizó ningún pago.')
    return
  }

  // Guardar
  console.log(`\n💾 Guardando ${updated} cambios en Supabase...`)
  const { error: saveError } = await supabase
    .from('kv_store')
    .upsert({ key: HOT_KEY, value: state, updated_at: new Date().toISOString() })

  if (saveError) {
    console.error('❌ Error al guardar:', saveError.message)
    process.exit(1)
  }

  console.log(`✅ Listo. ${updated} nombres actualizados.`)
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
