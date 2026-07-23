// Pasa agente@paydece.io a SUPERADMIN-MS y le borra todos los accesos anteriores.
//
// CORRER SOLO DESPUÉS DE DEPLOYAR el código de unidades de negocio.
// Antes del deploy, la producción todavía no sabe qué es una unidad: un role='admin'
// ahí adentro es un super admin de CriptoBlue con acceso a TODO. Por eso este cambio
// va después y no antes.
//
//   node scripts/migrar-agente-a-ms.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { UNIDADES } from './_unidades.mjs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const EMAIL = 'agente@paydece.io'

const { data: antes } = await s.from('app_users').select('*').eq('email', EMAIL).maybeSingle()
if (!antes) { console.error(`No existe ${EMAIL} en app_users.`); process.exit(1) }

console.log('══ ANTES ══')
console.log(JSON.stringify({
  role: antes.role, unidad: antes.unidad, store_id: antes.store_id,
  wallet: antes.wallet, billetera_permiso: antes.billetera_permiso,
  permisos: antes.permisos, accesos_extra: antes.accesos_extra,
}, null, 2))

// Se le borra TODO lo anterior (billetera MS, tienda Casa Perfecta, permisos) y queda
// únicamente como super admin de la unidad MS: ve la app completa, con su propia
// información — que hoy está vacía, sin tiendas ni billeteras conectadas.
const { error } = await s.from('app_users').update({
  role: 'admin',
  unidad: 'ms',
  store_id: null,
  wallet: null,
  billetera_permiso: null,
  permisos: {},
  accesos_extra: [],
}).eq('email', EMAIL)
if (error) throw new Error(error.message)

// Claim del JWT: sin esto el middleware lo sigue tratando como 'billetera' hasta que
// venza su sesión, y no lo dejaría entrar a /finanzas.
for (let page = 1; page <= 10; page++) {
  const { data } = await s.auth.admin.listUsers({ page, perPage: 200 })
  const hit = data?.users.find(u => (u.email || '').toLowerCase() === EMAIL)
  if (hit) {
    await s.auth.admin.updateUserById(hit.id, { app_metadata: { cb_role: 'admin', cb_store_id: null } })
    console.log('\nclaim del JWT sincronizado → admin')
    break
  }
  if (!data || data.users.length < 200) { console.log('\n(nunca se logueó: el claim se setea en su primer login)'); break }
}

const { data: despues } = await s.from('app_users').select('*').eq('email', EMAIL).maybeSingle()
console.log('\n══ DESPUÉS ══')
console.log(JSON.stringify({
  rol: UNIDADES[despues.unidad].rol, unidad: despues.unidad, store_id: despues.store_id,
  wallet: despues.wallet, accesos_extra: despues.accesos_extra,
}, null, 2))
console.log(`\n${EMAIL} entra con su Gmail de siempre y ve la app completa de ${UNIDADES[despues.unidad].nombre}, vacía.`)
