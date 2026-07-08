// Alta/actualización de usuarios de la app (tabla app_users).
//
// Uso (desde la raíz del proyecto):
//   node scripts/agregar-usuario.mjs <email> admin
//   node scripts/agregar-usuario.mjs <email> tienda <storeId> ["Nombre a mostrar"]
//   node scripts/agregar-usuario.mjs --listar
//   node scripts/agregar-usuario.mjs --borrar <email>
//
// Si el usuario ya se logueó alguna vez (existe en Supabase Auth), también
// sincroniza el claim del JWT (app_metadata.cb_role) para que el cambio de rol
// aplique sin esperar al próximo login.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

async function buscarAuthUser(email) {
  // La admin API no filtra por email: paginamos (pocos usuarios, alcanza).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const hit = data.users.find(u => (u.email || '').toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 200) break
  }
  return null
}

async function sincronizarClaim(email, role, storeId) {
  const authUser = await buscarAuthUser(email)
  if (!authUser) {
    console.log('  (todavía no se logueó nunca — el claim se setea solo en su primer login)')
    return
  }
  const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
    app_metadata: { cb_role: role, cb_store_id: storeId ?? null },
  })
  if (error) throw new Error(error.message)
  console.log('  claim del JWT sincronizado (aplica en su próximo refresh de sesión)')
}

const [, , a, b, c, d] = process.argv

if (a === '--listar') {
  const { data, error } = await supabase.from('app_users').select('*').order('role')
  if (error) throw new Error(error.message)
  console.table(data)
  process.exit(0)
}

if (a === '--borrar') {
  const email = (b || '').toLowerCase().trim()
  if (!email) { console.error('Falta el email'); process.exit(1) }
  const { error } = await supabase.from('app_users').delete().eq('email', email)
  if (error) throw new Error(error.message)
  console.log(`Borrado ${email} de app_users (las APIs le cortan el acceso en la próxima request).`)
  // Sacar también el claim para que el middleware lo bloquee al refrescar el token.
  const authUser = await buscarAuthUser(email)
  if (authUser) {
    await supabase.auth.admin.updateUserById(authUser.id, { app_metadata: { cb_role: null, cb_store_id: null } })
    console.log('  claim del JWT limpiado.')
  }
  process.exit(0)
}

const email = (a || '').toLowerCase().trim()
const role = (b || '').toLowerCase().trim()
const storeId = role === 'tienda' ? (c || '').trim() : null
const displayName = role === 'tienda' ? (d || null) : (c || null)

if (!email || !['admin', 'tienda'].includes(role) || (role === 'tienda' && !storeId)) {
  console.error('Uso: node scripts/agregar-usuario.mjs <email> admin | <email> tienda <storeId> ["Nombre"]')
  process.exit(1)
}

if (role === 'tienda') {
  // Validar que la tienda exista en el directorio.
  const { data: stores } = await supabase.from('kv_store').select('value').eq('key', 'criptoblue:stores').maybeSingle()
  const tienda = stores?.value?.[storeId]
  if (!tienda) {
    console.error(`storeId "${storeId}" no existe en criptoblue:stores. Tiendas disponibles:`)
    for (const [id, s] of Object.entries(stores?.value ?? {})) console.error(`  ${id} → ${s.storeName}`)
    process.exit(1)
  }
  console.log(`Tienda: ${tienda.storeName} (${storeId})`)
}

const { error } = await supabase.from('app_users').upsert({
  email, role, store_id: storeId, display_name: displayName,
})
if (error) throw new Error(error.message)
console.log(`OK: ${email} → rol ${role}${storeId ? ` · tienda ${storeId}` : ''}`)
await sincronizarClaim(email, role, storeId)
