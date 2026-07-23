// Genera / lista / revoca API keys de tienda para GET /api/v1/registro.
// La key en texto plano se muestra UNA sola vez (al generarla). En la DB va solo el hash.
//
// Uso (desde la raíz del proyecto):
//   node scripts/generar-api-key.mjs <storeId> ["Etiqueta"]
//   node scripts/generar-api-key.mjs --listar [storeId]
//   node scripts/generar-api-key.mjs --revocar <keyId>

import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { UNIDADES, buscarTienda, listarTiendas } from './_unidades.mjs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const PREFIX = 'cb_live_'
const hashKey = (k) => createHash('sha256').update(k.trim()).digest('hex')

const [, , cmd, arg2, ...rest] = process.argv

if (cmd === '--listar') {
  let q = s.from('store_api_keys').select('id, unidad, store_id, key_prefix, label, created_at, revoked_at, last_used_at').order('id')
  if (arg2) q = q.eq('store_id', arg2)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  console.table(data)
  process.exit(0)
}

if (cmd === '--revocar') {
  const id = Number(arg2)
  if (!Number.isInteger(id)) { console.error('Falta el id de la key. Uso: --revocar <keyId>'); process.exit(1) }
  const { error } = await s.from('store_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  console.log(`Key #${id} revocada (deja de funcionar en la próxima request).`)
  process.exit(0)
}

// ── Generar ───────────────────────────────────────────────────────────────────
const storeId = (cmd || '').trim()
const label = [arg2, ...rest].filter(Boolean).join(' ') || null
if (!storeId) {
  console.error('Uso:\n  node scripts/generar-api-key.mjs <storeId> ["Etiqueta"]\n  node scripts/generar-api-key.mjs --listar [storeId]\n  node scripts/generar-api-key.mjs --revocar <keyId>')
  process.exit(1)
}

// La unidad de negocio de la key sale de la tienda: es la que después define qué
// datos devuelve la API pública (ver validarApiKey en lib/api-keys.ts).
const hit = await buscarTienda(s, storeId)
if (!hit) {
  console.error(`storeId "${storeId}" no existe en ninguna unidad. Tiendas disponibles:`)
  for (const linea of await listarTiendas(s)) console.error(linea)
  process.exit(1)
}
const { unidad, store } = hit

const key = PREFIX + randomBytes(24).toString('hex')  // cb_live_ + 48 hex
const key_prefix = key.slice(0, 12)
const { data, error } = await s.from('store_api_keys')
  .insert({ unidad, store_id: storeId, key_hash: hashKey(key), key_prefix, label })
  .select('id').single()
if (error) throw new Error(error.message)

console.log('')
console.log(`✅ API key generada para ${store.storeName} (${storeId}) · unidad ${UNIDADES[unidad].nombre}`)
console.log(`   key #${data.id}${label ? ` · ${label}` : ''}`)
console.log('')
console.log('   ┌─────────────────────────────────────────────────────────────────┐')
console.log(`   │  ${key}`)
console.log('   └─────────────────────────────────────────────────────────────────┘')
console.log('')
console.log('   ⚠️  Guardala AHORA: no se vuelve a mostrar (en la DB solo queda el hash).')
console.log('   Se usa como:  Authorization: Bearer <key>')
