import { createClient } from '@supabase/supabase-js'
import type { AppState, Store, Payment, ErrorEntry, ActivityEntry, UnmatchedPayment } from './types'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS } from './config'

function stripRawData(payment: Payment): Payment {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rawData: _, ...rest } = payment
  return rest as Payment
}

// Supabase schema required:
// CREATE TABLE kv_store (
//   key TEXT PRIMARY KEY,
//   value JSONB NOT NULL,
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );

function getClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  return createClient(url, key)
}

const STORES_KEY = 'criptoblue:stores'
const STATE_KEY = 'criptoblue:state'

async function kvGet<T>(key: string): Promise<T | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('kv_store')
    .select('value')
    .eq('key', key)
    .single()
  // PGRST116 = "no rows found" — es válido, significa que no hay data guardada aún
  if (error && error.code !== 'PGRST116') {
    throw new Error(`kvGet("${key}") falló: ${error.message} [${error.code}]`)
  }
  return (data?.value as T) ?? null
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from('kv_store')
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) {
    throw new Error(`kvSet("${key}") falló: ${error.message} [${error.code}]`)
  }
}

const DEFAULT_STATE: AppState = {
  processedPayments: [],
  registroLog: [],
  matchLog: [],
  recentMatches: [],
  unmatchedPayments: [],
  externallyMarkedOrders: [],
  externallyMarkedPayments: [],
  retainedPaymentIds: [],
  cachedOrders: [],
  cachedOrdersAt: '',
  lastMPCheck: '',
  currentPhase: 'idle',
  paymentOverrides: {},
  settings: {},
  persistedMonthStats: {},
  dismissedPairs: [],
  errorLog: [],
  activityLog: [],
}

// Nombres manuales para tiendas que la API de TN no devuelve bien
const STORE_NAME_OVERRIDES: Record<string, string> = {
  '5512981': 'Perla',
  '1935431': 'Chunas',
  '6557652': 'Deportivo',
  '4963651': 'Dege',
}

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
  if (modified) await kvSet(STORES_KEY, stores)

  return stores
}

export async function saveStore(store: Store): Promise<void> {
  const stores = await getStores()
  stores[store.storeId] = store
  await kvSet(STORES_KEY, stores)
}

export async function saveStores(stores: Record<string, Store>): Promise<void> {
  await kvSet(STORES_KEY, stores)
}

export async function loadState(): Promise<AppState> {
  const state = await kvGet<AppState>(STATE_KEY)
  if (!state) return { ...DEFAULT_STATE }

  return {
    ...DEFAULT_STATE,
    ...state,
    processedPayments: state.processedPayments || [],
    registroLog: state.registroLog || [],
    matchLog: state.matchLog || [],
    recentMatches: state.recentMatches || [],
    unmatchedPayments: state.unmatchedPayments || [],
    externallyMarkedOrders: state.externallyMarkedOrders || [],
    externallyMarkedPayments: state.externallyMarkedPayments || [],
    retainedPaymentIds: state.retainedPaymentIds || [],
    cachedOrders: state.cachedOrders || [],
    cachedOrdersAt: state.cachedOrdersAt || '',
    persistedMonthStats: state.persistedMonthStats || {},
    dismissedPairs: state.dismissedPairs || [],
    errorLog: state.errorLog || [],
    activityLog: state.activityLog || [],
    paymentOverrides: state.paymentOverrides || {},
  }
}

export async function saveState(state: AppState): Promise<void> {
  const cutoff48hMs = Date.now() - 48 * 60 * 60 * 1000
  // Cutoffs efectivos separados para pagos y órdenes
  const effectiveCutoffPaymentsMs = Math.max(cutoff48hMs, HARD_CUTOFF_PAYMENTS.getTime())
  const effectiveCutoffOrdersMs = Math.max(cutoff48hMs, HARD_CUTOFF_ORDERS.getTime())
  // Para datos mixtos (matchLog, recentMatches) usar el más permisivo (órdenes, que es más antiguo)
  const effectiveCutoffMinMs = Math.min(effectiveCutoffPaymentsMs, effectiveCutoffOrdersMs)

  // matchLog (backend): auto-expira a 48hs — solo para consultas del sistema, no toca persistedMonthStats
  state.matchLog = (state.matchLog || []).filter(e => new Date(e.timestamp).getTime() >= effectiveCutoffMinMs)

  // registroLog (UI): NUNCA expira automáticamente — solo se borra con el botón "Borrar Registro"

  // recentMatches: auto-cleanup al cutoff efectivo (solo se usa para resaltado verde en pestañas)
  state.recentMatches = (state.recentMatches || []).filter(m => new Date(m.matchedAt).getTime() >= effectiveCutoffMinMs)

  // unmatchedPayments: antes de eliminar los vencidos, registrarlos en registroLog (solo UI, no en matchLog)
  const expiredPayments = state.unmatchedPayments.filter(
    u => u.payment.fechaPago && new Date(u.payment.fechaPago).getTime() < effectiveCutoffPaymentsMs
  )
  const alreadyLoggedIds = new Set(
    (state.registroLog || []).map(e => e.mpPaymentId).filter(Boolean)
  )
  for (const u of expiredPayments) {
    if (!alreadyLoggedIds.has(u.payment.mpPaymentId)) {
      state.registroLog = state.registroLog || []
      state.registroLog.push({
        timestamp: u.payment.fechaPago,
        action: 'no_match',
        payment: u.payment,
        amount: u.payment.monto,
        mpPaymentId: u.payment.mpPaymentId,
      })
    }
  }

  // unmatchedPayments: eliminar los anteriores al cutoff efectivo de PAGOS
  // IMPORTANTE: usar getTime() para comparar correctamente fechas con distintos offsets de timezone
  state.unmatchedPayments = state.unmatchedPayments.filter(
    u => !u.payment.fechaPago || new Date(u.payment.fechaPago).getTime() >= effectiveCutoffPaymentsMs
  )


  if (state.processedPayments.length > 5000) {
    state.processedPayments = state.processedPayments.slice(-5000)
  }

  // Limpiar externallyMarkedPayments: eliminar entradas anteriores al cutoff efectivo de pagos
  // Se limpia SIEMPRE (no solo cuando >500) para que los pagos expiren igual que el resto
  state.externallyMarkedPayments = (state.externallyMarkedPayments || []).filter(
    e => new Date(e.markedAt).getTime() >= effectiveCutoffPaymentsMs
  )

  // Limpiar externallyMarkedOrders: mantener solo los últimos 500
  if ((state.externallyMarkedOrders || []).length > 500) {
    state.externallyMarkedOrders = (state.externallyMarkedOrders || []).slice(-500)
  }

  // Limpiar retainedPaymentIds: limitar a los últimos 1000
  if ((state.retainedPaymentIds || []).length > 1000) {
    state.retainedPaymentIds = (state.retainedPaymentIds || []).slice(-1000)
  }

  // errorLog: descarta errores resueltos con más de 7 días, y limita total a 500
  const cutoff7dMs = Date.now() - 7 * 24 * 60 * 60 * 1000
  state.errorLog = (state.errorLog || [])
    .filter(e => !e.resolved || new Date(e.timestamp).getTime() >= cutoff7dMs)
    .slice(-500)

  // activityLog: mantener solo las últimas 48hs, límite de 1000 entradas
  state.activityLog = (state.activityLog || [])
    .filter(e => new Date(e.timestamp).getTime() >= cutoff48hMs)
    .slice(-1000)

  // dismissedPairs: expirar pares con más de 48hs (el pago y la orden ya no estarán en la app)
  state.dismissedPairs = (state.dismissedPairs || []).filter(
    p => new Date(p.dismissedAt).getTime() >= cutoff48hMs
  )
  // Strip rawData from all Payment objects to prevent state bloat
  // (raw MP payment JSON is ~5-10KB per payment; with thousands of payments this would exceed Supabase limits)
  const clean: AppState = {
    ...state,
    unmatchedPayments: state.unmatchedPayments.map(u => ({
      ...u,
      payment: stripRawData(u.payment),
    })),
    registroLog: state.registroLog.map(e => ({
      ...e,
      payment: e.payment ? stripRawData(e.payment) : undefined,
    })),
    matchLog: state.matchLog.map(e => ({
      ...e,
      payment: e.payment ? stripRawData(e.payment) : undefined,
    })),
  }
  await kvSet(STATE_KEY, clean)
}

export function appendError(
  state: AppState,
  source: string,
  level: 'error' | 'warning' | 'info',
  message: string,
  context?: Record<string, unknown>
): void {
  state.errorLog = state.errorLog || []
  const entry: ErrorEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    source,
    level,
    message,
    context,
    resolved: false,
  }
  state.errorLog.push(entry)
}

export function incrementPersistedMonthStats(
  state: AppState,
  amount: number,
  source: 'emparejamiento' | 'manual_pagos' | 'manual_ordenes'
): void {
  const key = new Date().toISOString().slice(0, 7) // "YYYY-MM"
  state.persistedMonthStats = state.persistedMonthStats || {}
  const base = state.persistedMonthStats[key] || { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }
  const isMatched = source === 'emparejamiento'
  const isManual = source === 'manual_pagos' || source === 'manual_ordenes'
  state.persistedMonthStats[key] = {
    matchedCount:  base.matchedCount  + (isMatched ? 1 : 0),
    matchedVolume: base.matchedVolume + (isMatched ? amount : 0),
    manualCount:   base.manualCount   + (isManual  ? 1 : 0),
    manualVolume:  base.manualVolume  + (isManual  ? amount : 0),
  }
}

export function appendActivity(
  state: AppState,
  actor: 'human' | 'system',
  action: string,
  details?: Record<string, unknown>
): void {
  state.activityLog = state.activityLog || []
  const entry: ActivityEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    details,
  }
  state.activityLog.push(entry)
}
