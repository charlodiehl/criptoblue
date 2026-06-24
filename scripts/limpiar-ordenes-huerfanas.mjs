// Limpia del caché de órdenes las "huérfanas": órdenes cuya tienda ya no existe
// en la lista de tiendas conectadas (p.ej. una tienda eliminada cuyas órdenes
// quedaron en criptoblue:orders-cache).
//
// NO toca registro_log (lo ya cobrado se conserva), ni la lista de tiendas.
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/limpiar-ordenes-huerfanas.mjs             (dry-run)
//   node --env-file=.env.vercel-prod scripts/limpiar-ordenes-huerfanas.mjs --confirmar (ejecuta)

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const CONFIRMAR = process.argv.includes('--confirmar')
const ORDERS_KEY = 'criptoblue:orders-cache'
const STORES_KEY = 'criptoblue:stores'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) { console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.'); process.exit(1) }
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
  console.log(`\n=== Limpieza de órdenes huérfanas (${CONFIRMAR ? 'EJECUCIÓN REAL' : 'DRY-RUN'}) ===\n`)

  const [ordersCache, stores] = await Promise.all([kvGet(ORDERS_KEY), kvGet(STORES_KEY)])
  const cachedOrders = ordersCache?.cachedOrders ?? []
  const storeIds = new Set(Object.keys(stores ?? {}))

  console.log(`Tiendas conectadas (${storeIds.size}): ${[...storeIds].map(id => stores[id]?.storeName || id).join(', ')}\n`)

  const huerfanas = cachedOrders.filter(o => !storeIds.has(o.storeId))
  const conservadas = cachedOrders.filter(o => storeIds.has(o.storeId))

  // Agrupar huérfanas por tienda para mostrar
  const porTienda = {}
  for (const o of huerfanas) {
    const k = `${o.storeName || '(sin nombre)'} [${o.storeId}]`
    porTienda[k] = (porTienda[k] ?? 0) + 1
  }

  console.log(`Órdenes en caché: ${cachedOrders.length}`)
  console.log(`  A conservar (tiendas existentes): ${conservadas.length}`)
  console.log(`  Huérfanas a eliminar:            ${huerfanas.length}`)
  for (const [t, n] of Object.entries(porTienda)) console.log(`    - ${t}: ${n} órdenes`)
  console.log('')

  if (huerfanas.length === 0) {
    console.log('No hay órdenes huérfanas. Nada que hacer.\n')
    return
  }

  // Backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = `backup-ordenes-cache-${stamp}.json`
  writeFileSync(backupFile, JSON.stringify(ordersCache, null, 2))
  console.log(`💾 Backup del caché completo guardado en: ${backupFile}`)

  if (!CONFIRMAR) {
    console.log('\n(DRY-RUN) No se modificó nada. Para ejecutar de verdad agregá --confirmar\n')
    return
  }

  ordersCache.cachedOrders = conservadas
  await kvSet(ORDERS_KEY, ordersCache)

  console.log('\n✅ Limpieza completa:')
  console.log(`  cachedOrders: ${cachedOrders.length} → ${conservadas.length}`)
  console.log(`  eliminadas:   ${huerfanas.length}\n`)
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1) })
