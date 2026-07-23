// Alta/actualización de usuarios de la app (tabla app_users).
//
// Cada usuario pertenece a UNA unidad de negocio (criptoblue | ms), que es lo que
// separa los datos de un negocio del otro. Los super admin se dan por su nombre de
// rol completo; para tienda/billetera la unidad va con --unidad (default criptoblue).
//
// Uso (desde la raíz del proyecto):
//   node scripts/agregar-usuario.mjs <email> superadmin-criptoblue
//   node scripts/agregar-usuario.mjs <email> superadmin-ms
//   node scripts/agregar-usuario.mjs <email> tienda <storeId> ["Nombre a mostrar"]
//   node scripts/agregar-usuario.mjs <email> billetera <wallet> <editor|lectura> ["Nombre"]
//   node scripts/agregar-usuario.mjs --listar
//   node scripts/agregar-usuario.mjs --borrar <email>
//
// Opción común:  --unidad <criptoblue|ms>   (para tienda/billetera)
//
// Si el usuario ya se logueó alguna vez (existe en Supabase Auth), también
// sincroniza el claim del JWT (app_metadata.cb_role) para que el cambio de rol
// aplique sin esperar al próximo login.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { UNIDADES, IDS, UNIDAD_DEFAULT, unidadDeRol, parseUnidad, getStores } from './_unidades.mjs'

// Carga .env.local (saca comillas envolventes: SUPABASE_URL viene entre comillas y
// createClient las rechaza — sin esto el script falla con "Invalid supabaseUrl").
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('=')
  if (i <= 0) continue
  const k = l.slice(0, i).trim()
  let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
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

// --unidad <id> se puede pasar en cualquier posición; se saca de los argumentos.
const argv = process.argv.slice(2)
let unidadFlag = null
const iFlag = argv.findIndex(a => a === '--unidad')
if (iFlag >= 0) {
  unidadFlag = parseUnidad(argv[iFlag + 1])
  argv.splice(iFlag, 2)
}

const [a, b, c, d, e] = argv

if (a === '--listar') {
  const { data, error } = await supabase.from('app_users').select('*').order('unidad').order('role')
  if (error) throw new Error(error.message)
  console.table(data.map(u => ({
    email: u.email,
    rol: u.role === 'admin' ? UNIDADES[parseUnidad(u.unidad)].rol : u.role,
    unidad: u.unidad ?? UNIDAD_DEFAULT,
    tienda: u.store_id ?? '',
    billetera: u.wallet ? `${u.wallet} (${u.billetera_permiso})` : '',
    extra: (u.accesos_extra ?? []).map(x => `${x.tipo}:${x.id}`).join(' '),
  })))
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
const rolPedido = (b || '').toLowerCase().trim()

const USO = 'Uso:\n' +
  `  node scripts/agregar-usuario.mjs <email> ${IDS.map(i => UNIDADES[i].rol).join(' | ')}\n` +
  '  node scripts/agregar-usuario.mjs <email> tienda <storeId> ["Nombre"] [--unidad criptoblue|ms]\n' +
  '  node scripts/agregar-usuario.mjs <email> billetera <wallet> <editor|lectura> ["Nombre"] [--unidad criptoblue|ms]'

// El rol de super admin trae la unidad puesta ('superadmin-ms' → unidad ms).
const unidadDelRolSuper = unidadDeRol(rolPedido)
const role = unidadDelRolSuper ? 'admin' : rolPedido

if (!email || !['admin', 'tienda', 'billetera'].includes(role)) {
  console.error(USO)
  process.exit(1)
}

const unidad = unidadDelRolSuper ?? unidadFlag ?? UNIDAD_DEFAULT
console.log(`Unidad de negocio: ${UNIDADES[unidad].nombre} (${unidad})`)

let fila
let storeIdClaim = null

if (role === 'tienda') {
  const storeId = (c || '').trim()
  if (!storeId) { console.error(USO); process.exit(1) }
  // Validar que la tienda exista en el directorio DE SU UNIDAD.
  const stores = await getStores(supabase, unidad)
  const tienda = stores[storeId]
  if (!tienda) {
    console.error(`storeId "${storeId}" no existe en las tiendas de ${UNIDADES[unidad].nombre}. Disponibles:`)
    for (const [id, s] of Object.entries(stores)) console.error(`  ${id} → ${s.storeName}`)
    process.exit(1)
  }
  console.log(`Tienda: ${tienda.storeName} (${storeId})`)
  // No se tocan los permisos del integrante (los administra su tienda).
  fila = { email, role, unidad, store_id: storeId, wallet: null, billetera_permiso: null, display_name: d || null }
  storeIdClaim = storeId
} else if (role === 'billetera') {
  const wallet = (c || '').trim()
  const permiso = (d || '').toLowerCase().trim()
  const wallets = UNIDADES[unidad].wallets
  if (!wallets.includes(wallet)) {
    console.error(`Billetera inválida para ${UNIDADES[unidad].nombre}. Opciones: ${wallets.join(', ') || '(esta unidad todavía no tiene billeteras)'}`)
    process.exit(1)
  }
  if (!['editor', 'lectura'].includes(permiso)) { console.error('Permiso inválido (editor | lectura)'); process.exit(1) }
  console.log(`Billetera: ${wallet} · permiso ${permiso}`)
  // Limpia restos de un rol anterior: sin tienda ni permisos de tienda.
  fila = { email, role, unidad, store_id: null, wallet, billetera_permiso: permiso, permisos: {}, display_name: e || null }
} else {
  // Super admin de una unidad: ve y opera TODO lo de su unidad, y nada de la otra.
  fila = { email, role, unidad, store_id: null, wallet: null, billetera_permiso: null, display_name: c || null }
}

const { error } = await supabase.from('app_users').upsert(fila)
if (error) throw new Error(error.message)
console.log(`OK: ${email} → rol ${unidadDelRolSuper ? UNIDADES[unidad].rol : role}` +
  (fila.store_id ? ` · tienda ${fila.store_id}` : '') +
  (fila.wallet ? ` · billetera ${fila.wallet} (${fila.billetera_permiso})` : ''))
await sincronizarClaim(email, role, storeIdClaim)
