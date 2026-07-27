// Da el permiso 'ver_saldo' a TODOS los integrantes que ya existían.
//
//   node scripts/backfill-ver-saldo.mjs             → ENSAYO
//   node scripts/backfill-ver-saldo.mjs --aplicar    → ejecuta
//
// Por qué hace falta: los permisos son "otorgar" (si la clave no está, no lo tiene).
// Al agregar 'ver_saldo', todo integrante que hoy ve su saldo lo perdería de golpe.
// El backfill se los da explícitamente, así el cambio arranca sin afectar a nadie y
// el permiso se empieza a usar recién al destildarlo a mano.
//
// Los que tienen 'administracion' no lo necesitan (ese permiso implica todos), pero
// igual se les escribe: así la fila queda consistente con lo que guarda la app cuando
// se marca Administración desde la pantalla de Equipo.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const APLICAR = process.argv.includes('--aplicar')

const { data, error } = await s.from('app_users').select('email, role, unidad, permisos, accesos_extra').eq('role', 'tienda')
if (error) throw new Error(error.message)

const pendientes = data.filter(u => (u.permisos ?? {}).ver_saldo !== true)
console.log(`integrantes con rol tienda: ${data.length} · sin 'ver_saldo': ${pendientes.length}\n`)
for (const u of pendientes) {
  const admin = (u.permisos ?? {}).administracion === true
  console.log(`  ${admin ? 'ADMIN ' : '      '}${u.email.padEnd(40)} [${u.unidad}] ${JSON.stringify(u.permisos ?? {})}`)
}

if (!APLICAR) { console.log('\n(ENSAYO — no se tocó nada. Correr con --aplicar.)'); process.exit(0) }

let n = 0
for (const u of pendientes) {
  const permisos = { ...(u.permisos ?? {}), ver_saldo: true }
  const { error: e } = await s.from('app_users').update({ permisos }).eq('email', u.email)
  if (e) throw new Error(`${u.email}: ${e.message}`)
  n++
}

// Los accesos EXTRA de tienda llevan sus propios permisos (hoy siempre
// { administracion: true }): se les agrega igual, por la misma consistencia.
let extras = 0
for (const u of data) {
  const lista = Array.isArray(u.accesos_extra) ? u.accesos_extra : []
  if (!lista.some(x => x?.tipo === 'tienda' && x?.permisos && x.permisos.ver_saldo !== true)) continue
  const nueva = lista.map(x => x?.tipo === 'tienda' && x?.permisos
    ? { ...x, permisos: { ...x.permisos, ver_saldo: true } } : x)
  const { error: e } = await s.from('app_users').update({ accesos_extra: nueva }).eq('email', u.email)
  if (e) throw new Error(`${u.email} (extra): ${e.message}`)
  extras++
}

console.log(`\n✅ ${n} integrante(s) actualizados${extras ? ` · ${extras} con accesos extra` : ''}.`)
