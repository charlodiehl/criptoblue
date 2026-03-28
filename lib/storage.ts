import { createClient } from '@supabase/supabase-js'
import type { AppState, Store, Payment, Order, LogEntry, UnmatchedPayment, RecentMatch, DismissedPair, ExternalPaymentMark, PersistedMonthStats, ErrorEntry, ActivityEntry } from './types'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS } from './config'

// ─────────────────────────────────────────────
// Supabase schema required:
// CREATE TABLE kv_store (
//   key TEXT PRIMARY KEY,
//   value JSONB NOT NULL,
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// ─────────────────────────────────────────────

// Cliente Supabase cacheado a nivel de módulo — reutiliza conexiones HTTP (#9)
let _client: ReturnType<typeof createClient> | null = null
function getClient() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  _client = createClient(url, key)
  return _client
}

// ─────────────────────────────────────────────
// Keys de Supabase — cada una almacena una parte del estado
// ─────────────────────────────────────────────
const HOT_KEY        = 'criptoblue:state'
const PROCESSED_KEY  = 'criptoblue:processed'
const ORDERS_KEY     = 'criptoblue:orders-cache'
const LOGS_KEY       = 'criptoblue:logs'
const MATCH_LOG_KEY  = 'criptoblue:match-log'
const STORES_KEY     = 'criptoblue:stores'

// ─────────────────────────────────────────────
// Tipos parciales por key
// ─────────────────────────────────────────────

// cachedOrdersAt vive SOLO en OrdersCacheState — fuente única de verdad (#5)
export type HotState = {
  unmatchedPayments: UnmatchedPayment[]
  recentMatches: RecentMatch[]
  externallyMarkedOrders: string[]
  externallyMarkedPayments: ExternalPaymentMark[]
  retainedPaymentIds: string[]
  lastMPCheck: string
  lastAutoMatchAt?: string
  lastAutoMatchMatched?: number
  currentPhase?: 'idle' | 'syncing' | 'auto-matching'
  paymentOverrides: Record<string, Partial<Payment>>
  settings: Record<string, unknown>
  persistedMonthStats: Record<string, PersistedMonthStats>
  dismissedPairs: DismissedPair[]
}

export type LogsState = {
  registroLog: LogEntry[]
  errorLog: ErrorEntry[]
  activityLog: ActivityEntry[]
}

export type MatchLogState = {
  matchLog: LogEntry[]
}

export type ProcessedState = {
  processedPayments: string[]
}

export type OrdersCacheState = {
  cachedOrders: Order[]
  cachedOrdersAt: string
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_HOT_STATE: HotState = {
  unmatchedPayments: [],
  recentMatches: [],
  externallyMarkedOrders: [],
  externallyMarkedPayments: [],
  retainedPaymentIds: [],
  lastMPCheck: '',
  lastAutoMatchAt: undefined,
  lastAutoMatchMatched: undefined,
  currentPhase: 'idle',
  paymentOverrides: {},
  settings: {},
  persistedMonthStats: {},
  dismissedPairs: [],
}

const DEFAULT_LOGS_STATE: LogsState = {
  registroLog: [],
  errorLog: [],
  activityLog: [],
}

const DEFAULT_MATCH_LOG_STATE: MatchLogState = {
  matchLog: [],
}

const DEFAULT_PROCESSED_STATE: ProcessedState = {
  processedPayments: [],
}

const DEFAULT_ORDERS_STATE: OrdersCacheState = {
  cachedOrders: [],
  cachedOrdersAt: '',
}

// ─────────────────────────────────────────────
// Nombres manuales para tiendas que la API de TN no devuelve bien
// ─────────────────────────────────────────────
const STORE_NAME_OVERRIDES: Record<string, string> = {
  '5512981': 'Perla',
  '1935431': 'Chunas',
  '6557652': 'Deportivo',
  '4963651': 'Dege',
}

// ─────────────────────────────────────────────
// Capa base de Supabase
// ─────────────────────────────────────────────

async function kvGet<T>(key: string): Promise<T | null> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('kv_store') as any)
    .select('value')
    .eq('key', key)
    .single()
  if (error && error.code !== 'PGRST116') {
    throw new Error(`kvGet("${key}") falló: ${error.message} [${error.code}]`)
  }
  return (data?.value as T) ?? null
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('kv_store') as any)
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) {
    throw new Error(`kvSet("${key}") falló: ${error.message} [${error.code}]`)
  }
}

// Retry con backoff — protege contra fallos de red transitorios (#1)
async function kvSetConRetry(key: string, value: unknown, intentos = 3): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      await kvSet(key, value)
      return
    } catch (e) {
      if (i === intentos - 1) throw e
      await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
}

// ─────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────

// Reemplaza rawData con {} para reducir tamaño sin romper el tipo Payment (#A4)
function stripRawData(payment: Payment): Payment {
  return { ...payment, rawData: {} }
}

function getCutoffs() {
  const cutoff48hMs = Date.now() - 48 * 60 * 60 * 1000
  const effectiveCutoffPaymentsMs = Math.max(cutoff48hMs, HARD_CUTOFF_PAYMENTS.getTime())
  const effectiveCutoffOrdersMs = Math.max(cutoff48hMs, HARD_CUTOFF_ORDERS.getTime())
  const effectiveCutoffMinMs = Math.min(effectiveCutoffPaymentsMs, effectiveCutoffOrdersMs)
  const cutoff30dMs = Date.now() - 30 * 24 * 60 * 60 * 1000
  const cutoff7dMs = Date.now() - 7 * 24 * 60 * 60 * 1000
  return { cutoff48hMs, effectiveCutoffPaymentsMs, effectiveCutoffOrdersMs, effectiveCutoffMinMs, cutoff30dMs, cutoff7dMs }
}

// Lógica de limpieza compartida entre saveHotState y saveState (#8)
function cleanHotData(state: HotState): HotState {
  const { cutoff48hMs, effectiveCutoffPaymentsMs, effectiveCutoffMinMs } = getCutoffs()
  const cleaned: HotState = {
    ...state,
    recentMatches: (state.recentMatches ?? []).filter(
      m => new Date(m.matchedAt).getTime() >= effectiveCutoffMinMs
    ),
    dismissedPairs: (state.dismissedPairs ?? []).filter(
      p => new Date(p.dismissedAt).getTime() >= cutoff48hMs
    ),
    externallyMarkedPayments: (state.externallyMarkedPayments ?? []).filter(
      e => new Date(e.markedAt).getTime() >= effectiveCutoffPaymentsMs
    ),
    externallyMarkedOrders: (state.externallyMarkedOrders ?? []).length > 500
      ? (state.externallyMarkedOrders ?? []).slice(-500)
      : (state.externallyMarkedOrders ?? []),
    retainedPaymentIds: (state.retainedPaymentIds ?? []).length > 1000
      ? (state.retainedPaymentIds ?? []).slice(-1000)
      : (state.retainedPaymentIds ?? []),
    unmatchedPayments: (state.unmatchedPayments ?? [])
      .filter(u => !u.payment.fechaPago || new Date(u.payment.fechaPago).getTime() >= effectiveCutoffPaymentsMs)
      .map(u => ({ ...u, payment: stripRawData(u.payment) })),
  }

  // Limpiar paymentOverrides de pagos que ya no están en unmatchedPayments (#M3)
  if (cleaned.paymentOverrides && Object.keys(cleaned.paymentOverrides).length > 0) {
    const activeIds = new Set(cleaned.unmatchedPayments.map(u => u.payment.mpPaymentId))
    for (const id of Object.keys(cleaned.paymentOverrides)) {
      if (!activeIds.has(id)) delete cleaned.paymentOverrides[id]
    }
  }

  return cleaned
}

function cleanLogsData(state: LogsState): LogsState {
  const { cutoff30dMs, cutoff7dMs } = getCutoffs()
  return {
    registroLog: (state.registroLog ?? [])
      .filter(e => new Date(e.timestamp).getTime() >= cutoff30dMs)
      .map(e => ({ ...e, payment: e.payment ? stripRawData(e.payment) : undefined })),
    errorLog: (state.errorLog ?? [])
      .filter(e => !e.resolved || new Date(e.timestamp).getTime() >= cutoff7dMs)
      .slice(-500),
    activityLog: (state.activityLog ?? [])
      .filter(e => new Date(e.timestamp).getTime() >= cutoff30dMs)
      .slice(-1000),
  }
}

function cleanMatchLogData(state: MatchLogState): MatchLogState {
  const { effectiveCutoffMinMs } = getCutoffs()
  return {
    matchLog: (state.matchLog ?? [])
      .filter(e => new Date(e.timestamp).getTime() >= effectiveCutoffMinMs)
      .map(e => ({ ...e, payment: e.payment ? stripRawData(e.payment) : undefined })),
  }
}

function cleanProcessedData(state: ProcessedState): ProcessedState {
  return {
    processedPayments: (state.processedPayments ?? []).length > 5000
      ? (state.processedPayments ?? []).slice(-5000)
      : (state.processedPayments ?? []),
  }
}

// ─────────────────────────────────────────────
// Stores
// ─────────────────────────────────────────────

export async function getStores(): Promise<Record<string, Store>> {
  const stores = await kvGet<Record<string, Store>>(STORES_KEY)
  if (!stores) return {}

  let modified = false
  for (const [id, store] of Object.entries(stores)) {
    const override = STORE_NAME_OVERRIDES[id]
    if (override && store.storeName !== override) {
      stores[id] = { ...store, storeName: override }
      modified = true
    }
  }
  if (modified) await kvSetConRetry(STORES_KEY, stores)

  return stores
}

export async function saveStore(store: Store): Promise<void> {
  const stores = await getStores()
  stores[store.storeId] = store
  await kvSetConRetry(STORES_KEY, stores)
}

export async function saveStores(stores: Record<string, Store>): Promise<void> {
  await kvSetConRetry(STORES_KEY, stores)
}

// ─────────────────────────────────────────────
// Cargas parciales — cada endpoint carga solo lo que necesita
// ─────────────────────────────────────────────

export async function loadHotState(): Promise<HotState> {
  const data = await kvGet<HotState>(HOT_KEY)
  if (!data) return { ...DEFAULT_HOT_STATE }
  return { ...DEFAULT_HOT_STATE, ...data }
}

export async function loadLogs(): Promise<LogsState> {
  const data = await kvGet<LogsState>(LOGS_KEY)
  if (!data) return { ...DEFAULT_LOGS_STATE }
  return {
    registroLog: data.registroLog ?? [],
    errorLog: data.errorLog ?? [],
    activityLog: data.activityLog ?? [],
  }
}

export async function loadMatchLog(): Promise<MatchLogState> {
  const data = await kvGet<MatchLogState>(MATCH_LOG_KEY)
  if (!data) return { ...DEFAULT_MATCH_LOG_STATE }
  return { matchLog: data.matchLog ?? [] }
}

export async function loadProcessed(): Promise<ProcessedState> {
  const data = await kvGet<ProcessedState>(PROCESSED_KEY)
  if (!data) return { ...DEFAULT_PROCESSED_STATE }
  return { processedPayments: data.processedPayments ?? [] }
}

export async function loadOrdersCache(): Promise<OrdersCacheState> {
  const data = await kvGet<OrdersCacheState>(ORDERS_KEY)
  if (!data) return { ...DEFAULT_ORDERS_STATE }
  return {
    cachedOrders: data.cachedOrders ?? [],
    cachedOrdersAt: data.cachedOrdersAt ?? '',
  }
}

// ─────────────────────────────────────────────
// Guardados parciales con cleanup y retry
// ─────────────────────────────────────────────

export async function saveHotState(state: HotState): Promise<void> {
  const cleaned = cleanHotData(state)

  // Merge paymentOverrides — proteger PATCHes manuales contra race condition con el cron.
  // Si alguien hizo un PATCH directo a Supabase mientras este ciclo corría, el estado
  // que teníamos en memoria puede estar desactualizado y pisaría esos cambios.
  // Cargamos el valor actual de HOT_KEY y mergeamos los overrides que no tenemos,
  // descartando los que ya no tienen un pago activo.
  const current = await kvGet<HotState>(HOT_KEY)
  if (current?.paymentOverrides && Object.keys(current.paymentOverrides).length > 0) {
    const activeIds = new Set(cleaned.unmatchedPayments.map(u => u.payment.mpPaymentId))
    for (const [id, override] of Object.entries(current.paymentOverrides)) {
      if (activeIds.has(id) && !cleaned.paymentOverrides[id]) {
        cleaned.paymentOverrides[id] = override
      }
    }
  }

  await kvSetConRetry(HOT_KEY, cleaned)
}

export async function saveLogs(state: LogsState): Promise<void> {
  await kvSetConRetry(LOGS_KEY, cleanLogsData(state))
}

export async function saveMatchLog(state: MatchLogState): Promise<void> {
  await kvSetConRetry(MATCH_LOG_KEY, cleanMatchLogData(state))
}

export async function saveProcessed(state: ProcessedState): Promise<void> {
  await kvSetConRetry(PROCESSED_KEY, cleanProcessedData(state))
}

export async function saveOrdersCache(state: OrdersCacheState): Promise<void> {
  await kvSetConRetry(ORDERS_KEY, state)
}

// ─────────────────────────────────────────────
// loadState / saveState — carga y guarda todo (usado por cycle.ts)
// ─────────────────────────────────────────────

export async function loadState(): Promise<AppState> {
  const [hot, logs, matchLog, processed, orders] = await Promise.all([
    loadHotState(),
    loadLogs(),
    loadMatchLog(),
    loadProcessed(),
    loadOrdersCache(),
  ])

  return {
    ...hot,
    ...logs,
    ...matchLog,
    ...processed,
    cachedOrders: orders.cachedOrders,
    cachedOrdersAt: orders.cachedOrdersAt, // fuente de verdad: OrdersCacheState (#5)
  }
}

export async function saveState(state: AppState): Promise<void> {
  const { effectiveCutoffPaymentsMs } = getCutoffs()

  // Registrar pagos vencidos sin emparejar en registroLog antes de limpiar (#7: agrega source)
  const expiredPayments = (state.unmatchedPayments ?? []).filter(
    u => u.payment.fechaPago && new Date(u.payment.fechaPago).getTime() < effectiveCutoffPaymentsMs
  )
  const cutoff72hMs = Date.now() - 72 * 60 * 60 * 1000
  const alreadyLoggedIds = new Set(
    (state.registroLog ?? [])
      .filter(e => new Date(e.timestamp).getTime() >= cutoff72hMs)
      .map(e => e.mpPaymentId).filter(Boolean)
  )
  const registroLog = [...(state.registroLog ?? [])]
  for (const u of expiredPayments) {
    if (!alreadyLoggedIds.has(u.payment.mpPaymentId)) {
      registroLog.push({
        timestamp: u.payment.fechaPago,
        action: 'no_match',
        source: 'emparejamiento',
        payment: stripRawData(u.payment),
        amount: u.payment.monto,
        mpPaymentId: u.payment.mpPaymentId,
      })
    }
  }

  // HOT_KEY: usar saveHotState para aprovechar el merge de paymentOverrides (#race-condition)
  const hotInput: HotState = {
    unmatchedPayments: state.unmatchedPayments ?? [],
    recentMatches: state.recentMatches ?? [],
    externallyMarkedOrders: state.externallyMarkedOrders ?? [],
    externallyMarkedPayments: state.externallyMarkedPayments ?? [],
    retainedPaymentIds: state.retainedPaymentIds ?? [],
    lastMPCheck: state.lastMPCheck ?? '',
    lastAutoMatchAt: state.lastAutoMatchAt,
    lastAutoMatchMatched: state.lastAutoMatchMatched,
    currentPhase: state.currentPhase,
    paymentOverrides: state.paymentOverrides ?? {},
    settings: state.settings ?? {},
    persistedMonthStats: state.persistedMonthStats ?? {},
    dismissedPairs: state.dismissedPairs ?? [],
  }

  const logs = cleanLogsData({
    registroLog,
    errorLog: state.errorLog ?? [],
    activityLog: state.activityLog ?? [],
  })

  const matchLogData = cleanMatchLogData({ matchLog: state.matchLog ?? [] })
  const processed = cleanProcessedData({ processedPayments: state.processedPayments ?? [] })

  const orders: OrdersCacheState = {
    cachedOrders: state.cachedOrders ?? [],
    cachedOrdersAt: state.cachedOrdersAt ?? '',
  }

  await Promise.all([
    saveHotState(hotInput), // incluye cleanHotData + merge de paymentOverrides
    kvSetConRetry(LOGS_KEY, logs),
    kvSetConRetry(MATCH_LOG_KEY, matchLogData),
    kvSetConRetry(PROCESSED_KEY, processed),
    kvSetConRetry(ORDERS_KEY, orders),
  ])
}

// ─────────────────────────────────────────────
// Funciones auxiliares — mutan el objeto recibido (intencional)
// ─────────────────────────────────────────────

export function appendError(
  target: { errorLog: ErrorEntry[] },
  source: string,
  level: 'error' | 'warning' | 'info',
  message: string,
  context?: Record<string, unknown>
): void {
  target.errorLog = target.errorLog ?? []
  target.errorLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    source,
    level,
    message,
    context,
    resolved: false,
  })
}

export function appendActivity(
  target: { activityLog: ActivityEntry[] },
  actor: 'human' | 'system',
  action: string,
  details?: Record<string, unknown>
): void {
  target.activityLog = target.activityLog ?? []
  target.activityLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    details,
  })
}

export function incrementPersistedMonthStats(
  hot: { persistedMonthStats: Record<string, PersistedMonthStats> },
  amount: number,
  source: 'emparejamiento' | 'manual_pagos' | 'manual_ordenes'
): void {
  const now = new Date()
  const argOffset = -3 * 60
  const argTime = new Date(now.getTime() + argOffset * 60 * 1000)
  const key = argTime.toISOString().slice(0, 7)
  hot.persistedMonthStats = hot.persistedMonthStats ?? {}
  const base = hot.persistedMonthStats[key] ?? { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }
  const isMatched = source === 'emparejamiento'
  const isManual = source === 'manual_pagos' || source === 'manual_ordenes'
  hot.persistedMonthStats[key] = {
    matchedCount:  base.matchedCount  + (isMatched ? 1 : 0),
    matchedVolume: base.matchedVolume + (isMatched ? amount : 0),
    manualCount:   base.manualCount   + (isManual  ? 1 : 0),
    manualVolume:  base.manualVolume  + (isManual  ? amount : 0),
  }
}
