// Pausa o despausa el cron de CriptoBlue (flag criptoblue:cron-paused).
// Cuando está pausado, /api/run no corre: no refresca órdenes ni hace auto-match.
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/cron-pausa.mjs on    → PAUSA el cron
//   node --env-file=.env.vercel-prod scripts/cron-pausa.mjs off   → DESPAUSA el cron
//   node --env-file=.env.vercel-prod scripts/cron-pausa.mjs       → muestra el estado actual

import { createClient } from '@supabase/supabase-js'

const KEY = 'criptoblue:cron-paused'
const accion = process.argv[2]
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function estado() {
  const { data } = await supabase.from('kv_store').select('value').eq('key', KEY).maybeSingle()
  return data?.value === true || data?.value === 'true'
}

if (accion && accion !== 'on' && accion !== 'off') {
  console.error('Uso: cron-pausa.mjs [on|off]')
  process.exit(1)
}

if (!accion) {
  const p = await estado()
  console.log(`Estado actual: cron ${p ? 'PAUSADO' : 'ACTIVO'} (cron-paused=${p})`)
  process.exit(0)
}

const paused = accion === 'on'
const { error } = await supabase.from('kv_store').upsert({ key: KEY, value: paused, updated_at: new Date().toISOString() })
if (error) { console.error('Error:', error.message); process.exit(1) }

const p = await estado()
console.log(`✅ cron ${p ? 'PAUSADO' : 'DESPAUSADO (ACTIVO)'} (cron-paused=${p})`)
