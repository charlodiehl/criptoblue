// Multi-acceso: da o quita accesos EXTRA a un usuario que ya existe (tabla app_users,
// columna accesos_extra). El acceso primario se sigue dando con agregar-usuario.mjs.
//
// Con más de un acceso, al usuario le aparece el menú lateral para cambiar entre sus
// tiendas y/o billeteras. Con uno solo ve la app como siempre. El cambio aplica en la
// próxima request (getSessionUser lee accesos_extra en cada llamada — NO hace falta
// que se re-loguee ni tocar el claim del JWT).
//
// Uso (desde la raíz del proyecto):
//   node scripts/agregar-acceso.mjs <email> tienda <storeId>
//   node scripts/agregar-acceso.mjs <email> billetera <wallet> <editor|lectura>
//   node scripts/agregar-acceso.mjs --quitar <email> <tienda|billetera> <id>
//   node scripts/agregar-acceso.mjs --listar <email>
//
// Nota: los accesos de tienda extra se dan con Administración (operan la tienda completa).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const WALLETS = ['MF', 'Lacar', 'MS', 'Montemar', 'Otras']

const USO = 'Uso:\n' +
  '  node scripts/agregar-acceso.mjs <email> tienda <storeId>\n' +
  '  node scripts/agregar-acceso.mjs <email> billetera <wallet> <editor|lectura>\n' +
  '  node scripts/agregar-acceso.mjs --quitar <email> <tienda|billetera> <id>\n' +
  '  node scripts/agregar-acceso.mjs --listar <email>'

async function getStores() {
  const { data } = await supabase.from('kv_store').select('value').eq('key', 'criptoblue:stores').maybeSingle()
  return data?.value ?? {}
}

async function getRow(email) {
  const { data, error } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function guardar(email, extra) {
  const { error } = await supabase.from('app_users').update({ accesos_extra: extra }).eq('email', email)
  if (error) throw new Error(error.message)
}

const [, , a, b, c, d] = process.argv

// ── Listar los accesos de un usuario ──────────────────────────────────────────
if (a === '--listar') {
  const email = (b || '').toLowerCase().trim()
  const row = await getRow(email)
  if (!row) { console.error('No existe ese usuario en app_users.'); process.exit(1) }
  const primario = row.role === 'tienda' ? `tienda ${row.store_id}`
    : row.role === 'billetera' ? `billetera ${row.wallet} (${row.billetera_permiso})`
      : row.role
  console.log(`${email}`)
  console.log(`  Primario: ${primario}`)
  console.log(`  Extra:    ${JSON.stringify(row.accesos_extra ?? [])}`)
  process.exit(0)
}

// ── Quitar un acceso extra ────────────────────────────────────────────────────
if (a === '--quitar') {
  const email = (b || '').toLowerCase().trim()
  const tipo = (c || '').toLowerCase().trim()
  const id = (d || '').trim()
  if (!email || !['tienda', 'billetera'].includes(tipo) || !id) { console.error(USO); process.exit(1) }
  const row = await getRow(email)
  if (!row) { console.error('No existe ese usuario.'); process.exit(1) }
  const antes = Array.isArray(row.accesos_extra) ? row.accesos_extra : []
  const despues = antes.filter(x => !(x?.tipo === tipo && x?.id === id))
  if (despues.length === antes.length) { console.error(`No tenía un acceso extra ${tipo} ${id}.`); process.exit(1) }
  await guardar(email, despues)
  console.log(`OK: quitado acceso extra ${tipo} ${id} de ${email}.`)
  process.exit(0)
}

// ── Agregar un acceso extra ───────────────────────────────────────────────────
const email = (a || '').toLowerCase().trim()
const tipo = (b || '').toLowerCase().trim()
if (!email || !['tienda', 'billetera'].includes(tipo)) { console.error(USO); process.exit(1) }

const row = await getRow(email)
if (!row) { console.error('Ese usuario no existe. Dale primero un acceso primario con agregar-usuario.mjs.'); process.exit(1) }
if (row.role === 'admin') { console.error('Un admin ya ve todo desde /finanzas: no se le agregan accesos extra.'); process.exit(1) }

const extra = Array.isArray(row.accesos_extra) ? row.accesos_extra : []

if (tipo === 'tienda') {
  const storeId = (c || '').trim()
  if (!storeId) { console.error(USO); process.exit(1) }
  const stores = await getStores()
  const tienda = stores[storeId]
  if (!tienda) {
    console.error(`storeId "${storeId}" no existe en criptoblue:stores. Tiendas disponibles:`)
    for (const [sid, s] of Object.entries(stores)) console.error(`  ${sid} → ${s.storeName}`)
    process.exit(1)
  }
  if (row.role === 'tienda' && row.store_id === storeId) { console.error('Esa ya es su tienda primaria.'); process.exit(1) }
  if (extra.some(x => x?.tipo === 'tienda' && x?.id === storeId)) { console.error('Ya tenía ese acceso extra.'); process.exit(1) }
  extra.push({ tipo: 'tienda', id: storeId, permisos: { administracion: true } })
  await guardar(email, extra)
  console.log(`OK: ${email} ahora también accede a la tienda ${tienda.storeName} (${storeId}).`)
} else {
  const wallet = (c || '').trim()
  const permiso = (d || '').toLowerCase().trim()
  if (!WALLETS.includes(wallet)) { console.error(`Billetera inválida. Opciones: ${WALLETS.join(', ')}`); process.exit(1) }
  if (!['editor', 'lectura'].includes(permiso)) { console.error('Permiso inválido (editor | lectura)'); process.exit(1) }
  if (row.role === 'billetera' && row.wallet === wallet) { console.error('Esa ya es su billetera primaria.'); process.exit(1) }
  const idx = extra.findIndex(x => x?.tipo === 'billetera' && x?.id === wallet)
  if (idx >= 0) extra[idx] = { tipo: 'billetera', id: wallet, billeteraPermiso: permiso }  // actualiza permiso
  else extra.push({ tipo: 'billetera', id: wallet, billeteraPermiso: permiso })
  await guardar(email, extra)
  console.log(`OK: ${email} ahora también accede a la billetera ${wallet} (${permiso}).`)
}

console.log('Aplica en su próxima request (no hace falta re-login).')
