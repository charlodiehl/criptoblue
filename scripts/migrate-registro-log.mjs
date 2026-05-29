/**
 * Migración registroLog (blobs JSONB) → tabla relacional registro_log.
 *
 * DDL (crear tabla/índices/función) NO se puede hacer con el service key:
 * eso se corre UNA vez en la consola SQL de Supabase (PASO 1 del .sql).
 * Todo lo demás lo hace este script (vía supabase-js):
 *
 *   node scripts/migrate-registro-log.mjs probe     # estado actual (tabla, blobs, conteos)
 *   node scripts/migrate-registro-log.mjs pause     # set flag criptoblue:cron-paused = true
 *   node scripts/migrate-registro-log.mjs sync       # insertar entradas faltantes (idempotente)
 *   node scripts/migrate-registro-log.mjs verify     # comparar conteos blobs vs tabla
 *   node scripts/migrate-registro-log.mjs resume      # borrar flag → reanuda el cron
 *   node scripts/migrate-registro-log.mjs cleanup --yes  # PASO 9: quitar registroLog de los blobs
 *
 * `sync` sirve tanto para la migración inicial como para el catch-up posterior:
 * lee todas las entradas de los blobs, deduplica, y solo inserta las que aún no
 * existen en la tabla (identidad: ts+action+mpPaymentId+orderId).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Cargar variables de entorno desde .env.local
const envPath = resolve(process.cwd(), '.env.local')
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TABLE = 'registro_log'
const CRON_PAUSED_KEY = 'criptoblue:cron-paused'
const LOGS_KEY = 'criptoblue:logs'

// ── helpers ────────────────────────────────────────────────

// Mapeo espejo de entryToRow() en lib/registro.ts
function entryToRow(e) {
  return {
    ts: e.timestamp,
    action: e.action,
    source: e.source ?? null,
    triggered_by: e.triggeredBy ?? null,
    score: e.score ?? null,
    amount: e.amount ?? null,
    order_total: e.orderTotal ?? null,
    order_number: e.orderNumber ?? null,
    order_id: e.orderId ?? null,
    store_id: e.storeId ?? null,
    store_name: e.storeName ?? null,
    customer_name: e.customerName ?? null,
    cuit_pagador: e.cuitPagador ?? null,
    mp_payment_id: e.mpPaymentId ?? null,
    payment_received_at: e.paymentReceivedAt ?? null,
    order_created_at: e.orderCreatedAt ?? null,
    hidden: e.hidden ?? false,
    copied_at: e.copiedAt ?? null,
    payment: e.payment ? { ...e.payment, rawData: {} } : null,
    order_data: e.order ?? null,
  }
}

// Identidad robusta: epoch-millis evita mismatch de formato (-03:00 vs Z)
function identityKey(ts, action, mp, order) {
  const ms = new Date(ts).getTime()
  return `${Number.isFinite(ms) ? ms : ts}|${action}|${mp || ''}|${order || ''}`
}

async function tableExists() {
  // OJO: head:true devuelve error=null aunque la tabla no esté en el schema cache
  // de PostgREST (count llega null). Hacemos un select real de 1 fila para no
  // tener falsos positivos.
  const { error } = await supabase.from(TABLE).select('id').limit(1)
  if (!error) return true
  if (error.code === '42P01' || error.code === 'PGRST205') return false // no existe / no en cache
  throw new Error(`No se pudo chequear la tabla: ${error.message} [${error.code}]`)
}

// Lee todas las entradas de registroLog de los blobs (activo + archivos mensuales)
async function readBlobEntries() {
  const { data, error } = await supabase
    .from('kv_store')
    .select('key, value')
    .or(`key.eq.${LOGS_KEY},key.like.criptoblue:logs:20%`)
  if (error) throw new Error(`readBlobEntries falló: ${error.message} [${error.code}]`)

  const all = []
  for (const row of data ?? []) {
    const arr = row.value?.registroLog
    if (Array.isArray(arr)) all.push(...arr)
  }
  return all
}

// Dedup dentro de los blobs por identidad
function dedupEntries(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    if (!e?.timestamp || !e?.action) continue
    const k = identityKey(e.timestamp, e.action, e.mpPaymentId, e.orderId)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

// Trae el set de identidades ya presentes en la tabla (paginado)
async function existingIdentitySet() {
  const set = new Set()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('ts, action, mp_payment_id, order_id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`existingIdentitySet falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) {
      set.add(identityKey(r.ts, r.action, r.mp_payment_id, r.order_id))
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return set
}

async function blobEntryCount() {
  const entries = await readBlobEntries()
  return { raw: entries.length, deduped: dedupEntries(entries).length }
}

async function tableRowCount() {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true })
  if (error) throw new Error(`tableRowCount falló: ${error.message} [${error.code}]`)
  return count ?? 0
}

// ── comandos ───────────────────────────────────────────────

async function probe() {
  const exists = await tableExists()
  console.log(`Tabla registro_log existe: ${exists ? 'SÍ' : 'NO'}`)
  const { raw, deduped } = await blobEntryCount()
  console.log(`Entradas en blobs (raw): ${raw}`)
  console.log(`Entradas en blobs (dedup): ${deduped}`)
  if (exists) {
    console.log(`Filas en la tabla: ${await tableRowCount()}`)
  }
  const { data } = await supabase.from('kv_store').select('value').eq('key', CRON_PAUSED_KEY).maybeSingle()
  console.log(`Cron pausado (flag): ${data ? JSON.stringify(data.value) : 'NO (sin flag)'}`)
}

async function pause() {
  const { error } = await supabase.from('kv_store').upsert({ key: CRON_PAUSED_KEY, value: true, updated_at: new Date().toISOString() })
  if (error) throw new Error(`pause falló: ${error.message} [${error.code}]`)
  console.log('✓ Cron PAUSADO (criptoblue:cron-paused = true)')
}

async function resume() {
  const { error } = await supabase.from('kv_store').delete().eq('key', CRON_PAUSED_KEY)
  if (error) throw new Error(`resume falló: ${error.message} [${error.code}]`)
  console.log('✓ Cron REANUDADO (flag borrado)')
}

async function sync() {
  if (!(await tableExists())) {
    console.error('❌ La tabla registro_log no existe. Corré primero el PASO 1 (DDL) en la consola SQL de Supabase.')
    process.exit(1)
  }
  const entries = dedupEntries(await readBlobEntries())
  const existing = await existingIdentitySet()
  const missing = entries.filter(e => !existing.has(identityKey(e.timestamp, e.action, e.mpPaymentId, e.orderId)))

  console.log(`Blobs (dedup): ${entries.length} · ya en tabla: ${entries.length - missing.length} · a insertar: ${missing.length}`)
  if (missing.length === 0) {
    console.log('✓ Nada para insertar — la tabla ya está al día.')
    return
  }

  const rows = missing.map(entryToRow)
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from(TABLE).insert(chunk)
    if (error) throw new Error(`insert (batch ${i / BATCH}) falló: ${error.message} [${error.code}]`)
    inserted += chunk.length
    console.log(`  insertadas ${inserted}/${rows.length}`)
  }
  console.log(`✓ Sync completo: ${inserted} filas insertadas. Total tabla: ${await tableRowCount()}`)
}

async function verify() {
  const { raw, deduped } = await blobEntryCount()
  const rows = await tableRowCount()
  console.log(`Blobs raw:    ${raw}`)
  console.log(`Blobs dedup:  ${deduped}`)
  console.log(`Filas tabla:  ${rows}`)
  if (rows >= deduped) console.log('✓ OK — la tabla tiene todas las entradas dedup de los blobs.')
  else console.log(`⚠ Faltan ${deduped - rows} filas en la tabla — re-ejecutá "sync".`)
}

async function cleanup() {
  if (!process.argv.includes('--yes')) {
    console.error('Refuse: cleanup borra el registroLog de los blobs. Re-ejecutá con --yes para confirmar.')
    process.exit(1)
  }
  // Verificación de seguridad: la tabla debe cubrir los blobs antes de limpiar
  const { deduped } = await blobEntryCount()
  const rows = await tableRowCount()
  if (rows < deduped) {
    console.error(`❌ Abortado: tabla (${rows}) < blobs dedup (${deduped}). Corré "sync" antes de limpiar.`)
    process.exit(1)
  }
  // Borrar archivos mensuales completos (solo contenían registroLog)
  const { error: delErr } = await supabase.from('kv_store').delete().like('key', 'criptoblue:logs:20%')
  if (delErr) throw new Error(`cleanup(delete archivos) falló: ${delErr.message} [${delErr.code}]`)
  // Quitar registroLog del blob activo preservando errorLog/activityLog
  const { data, error: selErr } = await supabase.from('kv_store').select('value').eq('key', LOGS_KEY).maybeSingle()
  if (selErr) throw new Error(`cleanup(select activo) falló: ${selErr.message} [${selErr.code}]`)
  if (data?.value && 'registroLog' in data.value) {
    const next = { ...data.value }
    delete next.registroLog
    const { error: updErr } = await supabase.from('kv_store').update({ value: next, updated_at: new Date().toISOString() }).eq('key', LOGS_KEY)
    if (updErr) throw new Error(`cleanup(update activo) falló: ${updErr.message} [${updErr.code}]`)
  }
  // Borrar el blob de match-log (retirado)
  await supabase.from('kv_store').delete().eq('key', 'criptoblue:match-log')
  console.log('✓ Cleanup completo: registroLog removido de los blobs, archivos y match-log borrados.')
}

// ── main ───────────────────────────────────────────────────

const cmd = process.argv[2]
const commands = { probe, pause, resume, sync, verify, cleanup }
if (!commands[cmd]) {
  console.error(`Comando desconocido: ${cmd ?? '(ninguno)'}\nUso: node scripts/migrate-registro-log.mjs <probe|pause|sync|verify|resume|cleanup>`)
  process.exit(1)
}
commands[cmd]().catch(err => { console.error('❌', err.message); process.exit(1) })
