// Fija como valor PROPIO la comisión que hoy tienen por default las tiendas y
// billeteras que no la tienen configurada.
//
// Para qué: DEFAULT_COMISION_TIENDA / DEFAULT_COMISION_BILLETERA (lib/comisiones.ts) no
// se aplican solo a lo nuevo — se aplican a todo lo que no tenga override, y de forma
// RETROACTIVA, porque la comisión se calcula al leer. Cambiar el default sin fijar antes
// lo existente les mueve el saldo a tiendas que llevan meses operando.
//
// Correrlo ANTES de tocar los defaults deja el cambio limitado a lo que conecte después.
//
//   node scripts/fijar-comisiones-actuales.mjs             → ENSAYO
//   node scripts/fijar-comisiones-actuales.mjs --aplicar   → escribe

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// Los defaults VIGENTES, los que hay que congelar. No se leen del código a propósito:
// si alguien corre esto después de cambiarlos, congelaría los nuevos y no serviría.
const DEFAULT_TIENDA_ACTUAL = 3.5
const DEFAULT_BILLETERA_ACTUAL = 1

// Billeteras por unidad (espejo de UNIDADES[x].wallets). "Otras" no lleva comisión.
const WALLETS = {
  criptoblue: ['MF', 'Lacar', 'MS', 'Montemar'],
  ms: ['Copter Hemat', 'Bitso FluoGames', 'LB CriptoBlue'],
}

const aplicar = process.argv.includes('--aplicar')
let cambios = 0

for (const unidad of ['criptoblue', 'ms']) {
  const { data: com } = await s.from('kv_store').select('value').eq('key', `${unidad}:comisiones`).maybeSingle()
  const { data: st } = await s.from('kv_store').select('value').eq('key', `${unidad}:stores`).maybeSingle()
  const cfg = com?.value ?? { tiendas: {}, billeteras: {} }
  const tiendas = { ...(cfg.tiendas ?? {}) }
  const billeteras = { ...(cfg.billeteras ?? {}) }

  console.log(`══ ${unidad} ══`)
  let toco = false

  for (const [id, v] of Object.entries(st?.value ?? {})) {
    if (id in tiendas) continue
    console.log(`   tienda    ${id.padEnd(28)} ${String(v.storeName).padEnd(16)} → se fija en ${DEFAULT_TIENDA_ACTUAL}%`)
    tiendas[id] = DEFAULT_TIENDA_ACTUAL
    toco = true; cambios++
  }
  for (const w of WALLETS[unidad]) {
    if (w in billeteras) continue
    console.log(`   billetera ${w.padEnd(45)} → se fija en ${DEFAULT_BILLETERA_ACTUAL}%`)
    billeteras[w] = DEFAULT_BILLETERA_ACTUAL
    toco = true; cambios++
  }
  if (!toco) { console.log('   (nada que fijar)'); continue }

  if (aplicar) {
    const { error } = await s.from('kv_store')
      .upsert({ key: `${unidad}:comisiones`, value: { ...cfg, tiendas, billeteras }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw new Error(`${unidad}: ${error.message}`)
    console.log('   ✓ guardado')
  }
  console.log('')
}

console.log(cambios === 0 ? 'Nada que fijar.' : `${cambios} valor(es) ${aplicar ? 'fijados.' : 'a fijar.'}`)
if (!aplicar && cambios) console.log('\n(ENSAYO — corré con --aplicar para escribir)')
