// Migra la tienda Hemat y la billetera Copter MS de la unidad 'criptoblue' a 'ms'.
//
//   node scripts/migrar-hemat-copter-a-ms.mjs            → ENSAYO (no toca nada)
//   node scripts/migrar-hemat-copter-a-ms.mjs --aplicar   → ejecuta
//
// Mueve las dos capas de aislamiento (ver lib/unidad.ts):
//   1. kv_store: las partes de 'criptoblue:*' que son de Hemat/Copter pasan a 'ms:*'.
//   2. Tablas:   sus filas cambian de unidad='criptoblue' a unidad='ms'.
//
// Antes de tocar nada guarda un backup JSON completo de lo que va a mover.
// Conviene pausar los crons de las dos unidades mientras corre (scripts/cron-pausa.mjs).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i <= 0) continue
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const APLICAR = process.argv.includes('--aplicar')

const TIENDA = '7284674'          // Hemat
const BILLETERA = 'Copter MS'
const SOURCE = 'copter'           // payment.source de los pagos de Copter
const USUARIO = 'martincastelucci11@gmail.com'

const esCopter = (id) => typeof id === 'string' && id.startsWith('copter-')
const log = []
const anotar = (t) => { log.push(t); console.log(t) }

// ── kv helpers ───────────────────────────────────────────────────────────────
const kv = {}
async function get(key) {
  if (key in kv) return kv[key]
  const { data } = await s.from('kv_store').select('value').eq('key', key).maybeSingle()
  kv[key] = data?.value ?? null
  return kv[key]
}
const pendientes = new Map()
function set(key, value) { pendientes.set(key, value) }

// Separa una lista en [seQueda, seVa] según un predicado.
function partir(lista, esDeMs) {
  const queda = [], va = []
  for (const x of lista ?? []) (esDeMs(x) ? va : queda).push(x)
  return [queda, va]
}

// ── 1. Directorio de tiendas ──────────────────────────────────────────────────
const storesCb = (await get('criptoblue:stores')) ?? {}
const storesMs = (await get('ms:stores')) ?? {}
const hemat = storesCb[TIENDA]
if (!hemat) { console.error(`La tienda ${TIENDA} no está en criptoblue:stores. ¿Ya se migró?`); process.exit(1) }
anotar(`Tienda: ${hemat.storeName} (${TIENDA})`)
const { [TIENDA]: _quitada, ...storesCbResto } = storesCb
set('criptoblue:stores', storesCbResto)
set('ms:stores', { ...storesMs, [TIENDA]: hemat })

// ── 2. Estado caliente (cola de pagos y marcas) ───────────────────────────────
const hotCb = (await get('criptoblue:state')) ?? {}
const hotMs = (await get('ms:state')) ?? {}

const [colaQueda, colaVa] = partir(hotCb.unmatchedPayments, u => u?.payment?.source === SOURCE)
const [matchQueda, matchVa] = partir(hotCb.recentMatches, m => m?.storeId === TIENDA || esCopter(m?.mpPaymentId))
const [ordQueda, ordVa] = partir(hotCb.externallyMarkedOrders, k => String(k).startsWith(`${TIENDA}-`))
const [pagQueda, pagVa] = partir(hotCb.externallyMarkedPayments, e => esCopter(e?.id))
const [retQueda, retVa] = partir(hotCb.retainedPaymentIds, esCopter)
const [disQueda, disVa] = partir(hotCb.dismissedPairs, p => p?.storeId === TIENDA || esCopter(p?.mpPaymentId))
const ovrVa = {}, ovrQueda = {}
for (const [id, v] of Object.entries(hotCb.paymentOverrides ?? {})) (esCopter(id) ? ovrVa : ovrQueda)[id] = v

anotar(`  cola de pagos:            ${colaVa.length} de ${(hotCb.unmatchedPayments ?? []).length}`)
anotar(`  emparejamientos recientes: ${matchVa.length}`)
anotar(`  órdenes marcadas externas: ${ordVa.length}`)
anotar(`  pagos marcados externos:   ${pagVa.length}`)
anotar(`  pares descartados:         ${disVa.length}`)

set('criptoblue:state', { ...hotCb, unmatchedPayments: colaQueda, recentMatches: matchQueda,
  externallyMarkedOrders: ordQueda, externallyMarkedPayments: pagQueda, retainedPaymentIds: retQueda,
  dismissedPairs: disQueda, paymentOverrides: ovrQueda })
set('ms:state', { ...hotMs,
  unmatchedPayments: [...(hotMs.unmatchedPayments ?? []), ...colaVa],
  recentMatches: [...(hotMs.recentMatches ?? []), ...matchVa],
  externallyMarkedOrders: [...(hotMs.externallyMarkedOrders ?? []), ...ordVa],
  externallyMarkedPayments: [...(hotMs.externallyMarkedPayments ?? []), ...pagVa],
  retainedPaymentIds: [...(hotMs.retainedPaymentIds ?? []), ...retVa],
  dismissedPairs: [...(hotMs.dismissedPairs ?? []), ...disVa],
  paymentOverrides: { ...(hotMs.paymentOverrides ?? {}), ...ovrVa },
  // persistedMonthStats NO se migra: con el circuito de terceros, Hemat nunca sumó a
  // las tarjetas del mes. MS arranca su conteo en cero y suma de acá en adelante.
  persistedMonthStats: hotMs.persistedMonthStats ?? {},
  settings: hotMs.settings ?? {}, lastMPCheck: hotMs.lastMPCheck ?? '', currentPhase: 'idle',
})

// ── 3. Cache de órdenes ───────────────────────────────────────────────────────
const ocCb = (await get('criptoblue:orders-cache')) ?? {}
const ocMs = (await get('ms:orders-cache')) ?? {}
const [ocQueda, ocVa] = partir(ocCb.cachedOrders, o => o?.storeId === TIENDA)
anotar(`  órdenes en cache:          ${ocVa.length}`)
set('criptoblue:orders-cache', { ...ocCb, cachedOrders: ocQueda })
set('ms:orders-cache', { cachedOrders: [...(ocMs.cachedOrders ?? []), ...ocVa], cachedOrdersAt: ocCb.cachedOrdersAt ?? '' })

// ── 4. Pagos ya procesados (dedup del webhook) ────────────────────────────────
const prCb = (await get('criptoblue:processed')) ?? {}
const prMs = (await get('ms:processed')) ?? {}
const [prQueda, prVa] = partir(prCb.processedPayments, esCopter)
anotar(`  pagos procesados:          ${prVa.length}`)
set('criptoblue:processed', { processedPayments: prQueda })
set('ms:processed', { processedPayments: [...(prMs.processedPayments ?? []), ...prVa] })

// ── 5. Comisiones, conceptos, cortes y ocultas ────────────────────────────────
const comCb = (await get('criptoblue:comisiones')) ?? {}
const comMs = (await get('ms:comisiones')) ?? {}
const { [TIENDA]: pctTienda, ...tiendasResto } = comCb.tiendas ?? {}
const { [BILLETERA]: pctBill, ...billResto } = comCb.billeteras ?? {}
anotar(`  comisión tienda:           ${pctTienda ?? '(default)'}`)
anotar(`  comisión billetera:        ${pctBill ?? '(default)'}`)
set('criptoblue:comisiones', { tiendas: tiendasResto, billeteras: billResto })
set('ms:comisiones', {
  tiendas: { ...(comMs.tiendas ?? {}), ...(pctTienda !== undefined ? { [TIENDA]: pctTienda } : {}) },
  billeteras: { ...(comMs.billeteras ?? {}), ...(pctBill !== undefined ? { [BILLETERA]: pctBill } : {}) },
})

const conceptos = await get(`criptoblue:conceptos:${TIENDA}`)
if (conceptos) { anotar(`  conceptos de la tienda:    ${conceptos.length}`); set(`ms:conceptos:${TIENDA}`, conceptos) }

const cortesCb = (await get('criptoblue:billetera-cortes')) ?? {}
if (cortesCb[BILLETERA]) {
  const { [BILLETERA]: corte, ...resto } = cortesCb
  anotar(`  corte de billetera:        sí`)
  set('criptoblue:billetera-cortes', resto)
  set('ms:billetera-cortes', { ...((await get('ms:billetera-cortes')) ?? {}), [BILLETERA]: corte })
}

const ocultasCb = (await get('criptoblue:billeteras-ocultas')) ?? []
if (ocultasCb.includes(BILLETERA)) {
  set('criptoblue:billeteras-ocultas', ocultasCb.filter(w => w !== BILLETERA))
  set('ms:billeteras-ocultas', [...new Set([...((await get('ms:billeteras-ocultas')) ?? []), BILLETERA])])
}

// ── 6. Logs (errores y actividad de Copter) ───────────────────────────────────
const lgCb = (await get('criptoblue:logs')) ?? {}
const lgMs = (await get('ms:logs')) ?? {}
const [errQueda, errVa] = partir(lgCb.errorLog, e => e?.source === SOURCE)
const [actQueda, actVa] = partir(lgCb.activityLog, a => String(a?.action ?? '').startsWith('copter_'))
anotar(`  errores de Copter:         ${errVa.length}`)
anotar(`  actividad de Copter:       ${actVa.length}`)
set('criptoblue:logs', { errorLog: errQueda, activityLog: actQueda })
set('ms:logs', { errorLog: [...(lgMs.errorLog ?? []), ...errVa], activityLog: [...(lgMs.activityLog ?? []), ...actVa] })

// ── 7. Tablas ─────────────────────────────────────────────────────────────────
// Cada una con el filtro que identifica lo que es de Hemat / Copter MS.
const TABLAS = [
  ['registro_log',      q => q.or(`store_id.eq.${TIENDA},mp_payment_id.like.copter-%`)],
  ['balance_movements', q => q.eq('store_id', TIENDA)],
  ['transfer_requests', q => q.eq('store_id', TIENDA)],
  ['refunds',           q => q.or(`store_id.eq.${TIENDA},wallet.eq.${BILLETERA}`)],
  ['refund_requests',   q => q.eq('store_id', TIENDA)],
  ['store_api_keys',    q => q.eq('store_id', TIENDA)],
  ['api_audit_log',     q => q.eq('store_id', TIENDA)],
  ['wallet_movements',  q => q.eq('wallet', BILLETERA)],
  ['app_users',         q => q.eq('email', USUARIO)],
]

anotar('\nFilas a mover de unidad criptoblue → ms:')
const conteos = {}
for (const [tabla, filtro] of TABLAS) {
  const { count, error } = await filtro(s.from(tabla).select('*', { count: 'exact', head: true }).eq('unidad', 'criptoblue'))
  if (error) throw new Error(`${tabla}: ${error.message}`)
  conteos[tabla] = count ?? 0
  anotar(`  ${tabla.padEnd(20)} ${count}`)
}

// ── Backup ────────────────────────────────────────────────────────────────────
if (!APLICAR) {
  console.log('\n(ENSAYO — no se tocó nada. Correr con --aplicar para ejecutar.)')
  process.exit(0)
}

const backup = { ts: new Date().toISOString(), kv: {}, tablas: {} }
for (const key of pendientes.keys()) backup.kv[key] = await get(key)   // valor ORIGINAL
for (const [tabla, filtro] of TABLAS) {
  if (!conteos[tabla]) continue
  const { data } = await filtro(s.from(tabla).select('*').eq('unidad', 'criptoblue'))
  backup.tablas[tabla] = data
}
const ruta = join(tmpdir(), `backup_migracion_hemat_copter_${Date.now()}.json`)
writeFileSync(ruta, JSON.stringify(backup, null, 1))
anotar(`\nBackup guardado en: ${ruta}`)

// ── Ejecutar ──────────────────────────────────────────────────────────────────
anotar('\nAplicando…')
for (const [tabla, filtro] of TABLAS) {
  if (!conteos[tabla]) { anotar(`  ${tabla}: nada que mover`); continue }
  const { error } = await filtro(s.from(tabla).update({ unidad: 'ms' }).eq('unidad', 'criptoblue'))
  if (error) throw new Error(`${tabla}: ${error.message}`)
  anotar(`  ${tabla}: ${conteos[tabla]} filas → ms`)
}
for (const [key, value] of pendientes) {
  const { error } = await s.from('kv_store').upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw new Error(`${key}: ${error.message}`)
  anotar(`  kv ${key}`)
}
// Avisar a los paneles abiertos que el estado cambió.
for (const key of pendientes.keys()) await s.from('kv_notifications').upsert({ key, notified_at: new Date().toISOString() })

anotar('\n✅ Migración aplicada.')
