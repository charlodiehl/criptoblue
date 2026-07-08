// Resetea el 2FA de un usuario que perdió su app de autenticación.
// Borra sus factores TOTP: en el próximo login se le pide configurar el 2FA de nuevo.
//
// Uso: node scripts/reset-mfa.mjs <email>

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const email = (process.argv[2] || '').toLowerCase().trim()
if (!email) { console.error('Uso: node scripts/reset-mfa.mjs <email>'); process.exit(1) }

let authUser = null
for (let page = 1; page <= 10; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw new Error(error.message)
  authUser = data.users.find(u => (u.email || '').toLowerCase() === email) ?? null
  if (authUser || data.users.length < 200) break
}
if (!authUser) { console.error(`No existe un usuario de Auth con email ${email} (¿nunca se logueó?)`); process.exit(1) }

const { data: factors, error: fErr } = await supabase.auth.admin.mfa.listFactors({ userId: authUser.id })
if (fErr) throw new Error(fErr.message)

const lista = factors?.factors ?? []
if (!lista.length) { console.log('No tiene factores 2FA cargados. Nada que borrar.'); process.exit(0) }

for (const f of lista) {
  const { error } = await supabase.auth.admin.mfa.deleteFactor({ userId: authUser.id, id: f.id })
  if (error) throw new Error(error.message)
  console.log(`Borrado factor ${f.factor_type} (${f.status}) ${f.id}`)
}
console.log(`Listo: ${email} deberá configurar el 2FA de nuevo en su próximo ingreso.`)
