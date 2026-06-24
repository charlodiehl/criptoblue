// Borra el REGISTRO HISTÓRICO de ventas y las estadísticas de las tarjetas.
//
// ⚠️ IRREVERSIBLE: registro_log es la fuente de verdad de la contabilidad.
// El script hace un backup completo a archivo ANTES de borrar nada.
//
// Borra:
//   - tabla registro_log          → TODAS las filas
//   - criptoblue:state            → persistedMonthStats (vacía a {})
//
// NO toca: stores, orders-cache, logs, ni el resto de criptoblue:state.
//
// Uso (carga credenciales desde el archivo de env):
//   node --env-file=.env.vercel-prod scripts/limpiar-registro.mjs             (dry-run)
//   node --env-file=.env.vercel-prod scripts/limpiar-registro.mjs --confirmar (ejecuta)

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const CONFIRMAR = process.argv.includes('--confirmar')
const TABLE = 'registro_log'
const HOT_KEY = 'criptoblue:state'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.')
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

// Lee TODAS las filas de registro_log, paginado.
async function leerTodoRegistro() {
  const out = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase.from(TABLE).select('*').order('ts', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`Error leyendo ${TABLE}: ${error.message}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
    if (from > 200000) break // tope de seguridad
  }
  return out
}

async function main() {
  console.log(`\n=== Limpieza de REGISTRO + estadísticas (${CONFIRMAR ? 'EJECUCIÓN REAL' : 'DRY-RUN'}) ===\n`)

  const filas = await leerTodoRegistro()
  const state = await kvGet(HOT_KEY)
  const statsKeys = Object.keys(state?.persistedMonthStats ?? {})

  // Resumen de volumen por si sirve para verificar
  let volTotal = 0
  for (const r of filas) volTotal += Number(r.amount) || 0

  console.log('A borrar:')
  console.log(`  registro_log:        ${filas.length} filas (volumen total ≈ $${volTotal.toLocaleString('es-AR')})`)
  console.log(`  persistedMonthStats: ${statsKeys.length} meses (${statsKeys.join(', ') || 'ninguno'})`)
  console.log('\nSe conservan: stores, orders-cache, logs, y el resto de criptoblue:state.\n')

  // Backup SIEMPRE (también en dry-run)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = `backup-registro-${stamp}.json`
  writeFileSync(backupFile, JSON.stringify({
    registro_log: filas,
    persistedMonthStats: state?.persistedMonthStats ?? {},
  }, null, 2))
  console.log(`💾 Backup completo guardado en: ${backupFile}`)

  if (!CONFIRMAR) {
    console.log('\n(DRY-RUN) No se borró nada. Para ejecutar de verdad agregá --confirmar\n')
    return
  }

  // Borrar todas las filas de registro_log (filtro sobre ts: todas las filas lo tienen)
  const { error: delErr } = await supabase.from(TABLE).delete().not('ts', 'is', null)
  if (delErr) throw new Error(`Error borrando ${TABLE}: ${delErr.message}`)

  // Vaciar persistedMonthStats en criptoblue:state
  if (state) {
    state.persistedMonthStats = {}
    await kvSet(HOT_KEY, state)
  }

  // Verificación post-borrado
  const { count, error: cntErr } = await supabase.from(TABLE).select('id', { count: 'exact', head: true })
  if (cntErr) throw new Error(`Error verificando ${TABLE}: ${cntErr.message}`)

  console.log('\n✅ Limpieza completa:')
  console.log(`  registro_log:        ${filas.length} → ${count ?? 0} filas`)
  console.log(`  persistedMonthStats: ${statsKeys.length} → 0 meses`)
  console.log('\nLas tarjetas del dashboard van a mostrar todo en cero.\n')
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
