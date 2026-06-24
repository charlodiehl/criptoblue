// Limpia SOLO la cola de pagos pendientes para empezar de cero (migración a Fiwind).
//
// Vacía:
//   - criptoblue:state    → unmatchedPayments, recentMatches
//   - criptoblue:processed → processedPayments
//
// NO toca: registro_log (historial de ventas), logs, orders-cache, stores,
// ni el resto de campos de criptoblue:state (dismissedPairs, persistedMonthStats,
// externallyMarkedPayments, etc.).
//
// Además pausa el cron (criptoblue:cron-paused) para que MercadoPago no
// re-popule la cola mientras se desconecta el token en Vercel.
//
// Uso (carga credenciales desde .env.local):
//   node --env-file=.env.local scripts/limpiar-cola-pagos.mjs            (dry-run: solo muestra)
//   node --env-file=.env.local scripts/limpiar-cola-pagos.mjs --confirmar (ejecuta de verdad)
//
// Antes de ejecutar hace un backup completo de ambas keys en un archivo JSON local.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const CONFIRMAR = process.argv.includes('--confirmar')
const HOT_KEY = 'criptoblue:state'
const PROCESSED_KEY = 'criptoblue:processed'
const CRON_PAUSED_KEY = 'criptoblue:cron-paused'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY. Completá .env.local y corré con: node --env-file=.env.local ...')
  process.exit(1)
}

const supabase = createClient(url, key)

async function kvGet(k) {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', k).maybeSingle()
  if (error) throw new Error(`Error leyendo ${k}: ${error.message}`)
  return data?.value ?? null
}

async function kvSet(k, value) {
  const { error } = await supabase.from('kv_store').upsert({ key: k, value, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Error escribiendo ${k}: ${error.message}`)
}

async function main() {
  console.log(`\n=== Limpieza de cola de pagos (${CONFIRMAR ? 'EJECUCIÓN REAL' : 'DRY-RUN'}) ===\n`)

  const [state, processed] = await Promise.all([kvGet(HOT_KEY), kvGet(PROCESSED_KEY)])
  if (!state) throw new Error('No se encontró criptoblue:state')

  const nUnmatched = state.unmatchedPayments?.length ?? 0
  const nRecent = state.recentMatches?.length ?? 0
  const nProcessed = processed?.processedPayments?.length ?? 0

  console.log('Estado actual:')
  console.log(`  unmatchedPayments: ${nUnmatched}`)
  console.log(`  recentMatches:     ${nRecent}`)
  console.log(`  processedPayments: ${nProcessed}`)
  console.log('\nSe conservan intactos: registro_log, logs, orders-cache, stores,')
  console.log('dismissedPairs, persistedMonthStats, externallyMarkedPayments, etc.\n')

  // Backup completo antes de tocar nada
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = `backup-cola-${stamp}.json`
  writeFileSync(backupFile, JSON.stringify({ state, processed }, null, 2))
  console.log(`💾 Backup guardado en: ${backupFile}`)

  if (!CONFIRMAR) {
    console.log('\n(DRY-RUN) No se modificó nada. Para ejecutar de verdad agregá --confirmar\n')
    return
  }

  // Vaciar solo los campos de cola
  state.unmatchedPayments = []
  state.recentMatches = []
  processed.processedPayments = []

  await kvSet(HOT_KEY, state)
  await kvSet(PROCESSED_KEY, processed)
  await kvSet(CRON_PAUSED_KEY, true)

  console.log('\n✅ Limpieza completa:')
  console.log(`  unmatchedPayments: ${nUnmatched} → 0`)
  console.log(`  recentMatches:     ${nRecent} → 0`)
  console.log(`  processedPayments: ${nProcessed} → 0`)
  console.log('  cron:              PAUSADO (criptoblue:cron-paused = true)')
  console.log('\n⚠️  Acordate de vaciar CRIPTOBLUE_MP_ACCESS_TOKEN en Vercel.')
  console.log('   Cuando Fiwind esté listo, despausamos el cron.\n')
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
