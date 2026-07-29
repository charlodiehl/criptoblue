// Traduce el permiso viejo de billetera (editor | lectura) al modelo nuevo.
//
//   node scripts/backfill-permisos-billetera.mjs             → ENSAYO
//   node scripts/backfill-permisos-billetera.mjs --aplicar    → ejecuta
//
// Correrlo ANTES de deployar: el código viejo ignora la columna nueva, así que hoy
// no cambia nada, y al deployar nadie pierde el acceso que ya tenía.
//   editor  → { administracion:false, registrar_retiros:true, ver_saldo:true }
//   lectura → { ver_saldo:true }

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

const traducir = (p) => (p === 'editor'
  ? { registrar_retiros: true, ver_saldo: true }
  : { ver_saldo: true })

const { data, error } = await s.from('app_users').select('email, role, unidad, wallet, billetera_permiso, billetera_permisos, accesos_extra')
if (error) throw new Error(error.message)

let n = 0, extras = 0
for (const u of data) {
  // Acceso PRIMARIO de billetera
  if (u.role === 'billetera' && u.wallet && !Object.keys(u.billetera_permisos ?? {}).length) {
    const permisos = traducir(u.billetera_permiso)
    console.log(`  ${u.email.padEnd(34)} [${u.unidad}] ${u.wallet} · ${u.billetera_permiso} → ${JSON.stringify(permisos)}`)
    if (APLICAR) {
      const { error: e } = await s.from('app_users').update({ billetera_permisos: permisos }).eq('email', u.email)
      if (e) throw new Error(`${u.email}: ${e.message}`)
    }
    n++
  }
  // Accesos EXTRA de billetera (dentro del JSONB accesos_extra)
  const lista = Array.isArray(u.accesos_extra) ? u.accesos_extra : []
  const pend = lista.filter(x => x?.tipo === 'billetera' && !x?.permisos)
  if (pend.length) {
    const nueva = lista.map(x => (x?.tipo === 'billetera' && !x?.permisos)
      ? { ...x, permisos: traducir(x.billeteraPermiso) } : x)
    console.log(`  ${u.email.padEnd(34)} [${u.unidad}] extra: ${pend.map(x => `${x.id}(${x.billeteraPermiso})`).join(', ')}`)
    if (APLICAR) {
      const { error: e } = await s.from('app_users').update({ accesos_extra: nueva }).eq('email', u.email)
      if (e) throw new Error(`${u.email} (extra): ${e.message}`)
    }
    extras++
  }
}

console.log(`\n${APLICAR ? '✅ Actualizados' : 'Se actualizarían'}: ${n} acceso(s) primario(s), ${extras} con accesos extra.`)
if (!APLICAR) console.log('(ENSAYO — correr con --aplicar.)')
