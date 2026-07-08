// Carga el saldo inicial de una tienda como movimiento de 'ajuste'.
// Los balances arrancan en 0 el día del deploy; cuando el usuario pase los
// saldos previos, se cargan con esto (una vez por tienda).
//
// Uso: node scripts/cargar-saldo-inicial.mjs <storeId> <ars> <usdt> ["descripción"]
// Ej.:  node scripts/cargar-saldo-inicial.mjs 123456 1500000 1020.50 "Saldo inicial julio"
// Los montos pueden ser negativos (deuda). Punto decimal, sin separador de miles.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const [, , storeId, arsStr, usdtStr, descripcion] = process.argv
const ars = Number(arsStr)
const usdt = Number(usdtStr)

if (!storeId || !Number.isFinite(ars) || !Number.isFinite(usdt)) {
  console.error('Uso: node scripts/cargar-saldo-inicial.mjs <storeId> <ars> <usdt> ["descripción"]')
  process.exit(1)
}

// Validar tienda y evitar duplicar el ajuste inicial por error
const { data: stores } = await supabase.from('kv_store').select('value').eq('key', 'criptoblue:stores').maybeSingle()
const tienda = stores?.value?.[storeId]
if (!tienda) {
  console.error(`storeId "${storeId}" no existe. Tiendas:`)
  for (const [id, s] of Object.entries(stores?.value ?? {})) console.error(`  ${id} → ${s.storeName}`)
  process.exit(1)
}

const { data: previos } = await supabase
  .from('balance_movements')
  .select('id, ars, usdt, descripcion')
  .eq('store_id', storeId)
  .eq('tipo', 'ajuste')
if (previos?.length) {
  console.warn(`⚠️ ${tienda.storeName} ya tiene ${previos.length} ajuste(s):`)
  for (const p of previos) console.warn(`  #${p.id} ars=${p.ars} usdt=${p.usdt} "${p.descripcion}"`)
  console.warn('Si es un saldo inicial repetido, revisá antes de continuar. (Se inserta igual: es un movimiento más.)')
}

const { error } = await supabase.from('balance_movements').insert({
  store_id: storeId,
  tipo: 'ajuste',
  fecha: new Date().toISOString(),
  ars,
  usdt,
  usdt_rate: null,
  rate_source: 'manual',
  descripcion: descripcion || `Saldo inicial — ${tienda.storeName}`,
})
if (error) throw new Error(error.message)
console.log(`OK: ajuste cargado a ${tienda.storeName} → ARS ${ars} · USDT ${usdt}`)
