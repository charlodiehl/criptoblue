// Asigna walletId a las tiendas ya conectadas, según el mapeo dado por el usuario:
//   MF:    Dege, Casa Perfecta, Syara, Alvia
//   Lacar: Perla, Jane Jones, Chunas, La Casona
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/migrar-billeteras-tiendas.mjs           (dry-run)
//   node --env-file=.env.vercel-prod scripts/migrar-billeteras-tiendas.mjs --confirmar

import { createClient } from '@supabase/supabase-js'

const CONFIRMAR = process.argv.includes('--confirmar')
const STORES_KEY = 'criptoblue:stores'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Mapeo por nombre de tienda (case-insensitive, sin acentos) → walletId
const WALLET_BY_NAME = {
  'dege': 'MF',
  'casa perfecta': 'MF',
  'syara': 'MF',
  'alvia': 'MF',
  'perla': 'Lacar',
  'jane jones': 'Lacar',
  'chunas': 'Lacar',
  'la casona': 'Lacar',
}

function normalizar(s) {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const { data, error } = await supabase.from('kv_store').select('value').eq('key', STORES_KEY).maybeSingle()
if (error) { console.error('Error leyendo tiendas:', error.message); process.exit(1) }
const stores = data.value || {}

console.log(`Tiendas encontradas: ${Object.keys(stores).length}\n`)

let cambios = 0
const sinMapeo = []
for (const [storeId, store] of Object.entries(stores)) {
  const wallet = WALLET_BY_NAME[normalizar(store.storeName)]
  if (!wallet) {
    sinMapeo.push(store.storeName)
    continue
  }
  if (store.walletId === wallet) {
    console.log(`  = ${store.storeName.padEnd(16)} ya tiene walletId="${wallet}"`)
    continue
  }
  console.log(`  → ${store.storeName.padEnd(16)} walletId: ${store.walletId || '(sin asignar)'} → "${wallet}"`)
  cambios++
  if (CONFIRMAR) stores[storeId].walletId = wallet
}

if (sinMapeo.length) {
  console.log(`\n⚠️  Sin mapeo conocido (no se tocan): ${sinMapeo.join(', ')}`)
}

console.log(`\nCambios ${CONFIRMAR ? 'aplicados' : 'a aplicar'}: ${cambios}`)

if (!CONFIRMAR) {
  console.log('\n(DRY-RUN) No se modificó nada. Agregá --confirmar para ejecutar.')
  process.exit(0)
}

if (cambios > 0) {
  const { error: upErr } = await supabase.from('kv_store').upsert({ key: STORES_KEY, value: stores, updated_at: new Date().toISOString() })
  if (upErr) { console.error('Error guardando:', upErr.message); process.exit(1) }
  console.log('\n✅ Guardado.')
} else {
  console.log('\nNada que guardar.')
}
