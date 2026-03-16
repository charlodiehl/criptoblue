import { createClient } from '@supabase/supabase-js'
import type { AppState, Store, Payment } from './types'
import { HARD_CUTOFF } from './config'

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
  const { data } = await supabase
    .from('kv_store')
    .select('value')
    .eq('key', key)
    .single()
  return (data?.value as T) ?? null
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const supabase = getClient()
  await supabase
    .from('kv_store')
    .upsert({ key, value, updated_at: new Date().toISOString() })
}

const DEFAULT_STATE: AppState = {
  processedPayments: [],
  matchLog: [],
  recentMatches: [],
  pendingMatches: [],
  unmatchedPayments: [],
  externallyMarkedOrders: [],
  externallyMarkedPayments: [],
  lastMPCheck: '',
  settings: {},
  monthlyStats: {},
}

// Nombres manuales para tiendas que la API de TN no devuelve bien
const STORE_NAME_OVERRIDES: Record<string, string> = {
  '5512981': 'Perla',
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
    matchLog: state.matchLog || [],
    recentMatches: state.recentMatches || [],
    pendingMatches: state.pendingMatches || [],
    unmatchedPayments: state.unmatchedPayments || [],
    externallyMarkedOrders: state.externallyMarkedOrders || [],
    externallyMarkedPayments: state.externallyMarkedPayments || [],
    monthlyStats: state.monthlyStats || {},
  }
}

export async function saveState(state: AppState): Promise<void> {
  const cutoff24hMs = Date.now() - 24 * 60 * 60 * 1000
  // Efectivo: el más reciente entre rolling 24h y el hard cutoff (comparación numérica, evita bugs de timezone en strings)
  const effectiveCutoffMs = Math.max(cutoff24hMs, HARD_CUTOFF.getTime())

  // matchLog: sin límite de tiempo — se limpia solo manualmente desde el Registro
  // Pero sí filtramos entradas anteriores al hard cutoff (datos de antes de la app)
  const hardCutoffMs = HARD_CUTOFF.getTime()
  state.matchLog = (state.matchLog || []).filter(e => new Date(e.timestamp).getTime() >= hardCutoffMs)

  // recentMatches: auto-cleanup al cutoff efectivo (solo se usa para resaltado verde en pestañas)
  state.recentMatches = (state.recentMatches || []).filter(m => new Date(m.matchedAt).getTime() >= effectiveCutoffMs)

  // unmatchedPayments: antes de eliminar los vencidos, registrarlos en el matchLog
  const expiredPayments = state.unmatchedPayments.filter(
    u => u.payment.fechaPago && new Date(u.payment.fechaPago).getTime() < effectiveCutoffMs
  )
  const alreadyLoggedIds = new Set(
    (state.matchLog || []).filter(e => e.action === 'no_match').map(e => e.mpPaymentId).filter(Boolean)
  )
  for (const u of expiredPayments) {
    if (!alreadyLoggedIds.has(u.payment.mpPaymentId)) {
      state.matchLog = state.matchLog || []
      state.matchLog.push({
        timestamp: u.payment.fechaPago,
        action: 'no_match',
        payment: u.payment,
        amount: u.payment.monto,
        mpPaymentId: u.payment.mpPaymentId,
      })
    }
  }

  // unmatchedPayments: eliminar los anteriores al cutoff efectivo
  // IMPORTANTE: usar getTime() para comparar correctamente fechas con distintos offsets de timezone
  state.unmatchedPayments = state.unmatchedPayments.filter(
    u => !u.payment.fechaPago || new Date(u.payment.fechaPago).getTime() >= effectiveCutoffMs
  )

  if (state.processedPayments.length > 5000) {
    state.processedPayments = state.processedPayments.slice(-5000)
  }

  // Limpiar externallyMarkedPayments: mantener solo los que sigan en matchLog o unmatchedPayments
  // Evita que el array crezca indefinidamente con entradas que ya no son relevantes
  const activePaymentIds = new Set([
    ...(state.unmatchedPayments || []).map(u => u.payment.mpPaymentId),
    ...(state.matchLog || []).map(e => e.mpPaymentId).filter(Boolean) as string[],
  ])
  if ((state.externallyMarkedPayments || []).length > 500) {
    state.externallyMarkedPayments = (state.externallyMarkedPayments || []).filter(
      id => activePaymentIds.has(id)
    )
  }

  // Limpiar externallyMarkedOrders: mantener solo los últimos 500
  if ((state.externallyMarkedOrders || []).length > 500) {
    state.externallyMarkedOrders = (state.externallyMarkedOrders || []).slice(-500)
  }
  // Strip rawData from all Payment objects to prevent state bloat
  // (raw MP payment JSON is ~5-10KB per payment; with thousands of payments this would exceed Supabase limits)
  const clean: AppState = {
    ...state,
    unmatchedPayments: state.unmatchedPayments.map(u => ({
      ...u,
      payment: stripRawData(u.payment),
    })),
    pendingMatches: state.pendingMatches.map(m => ({
      ...m,
      payment: stripRawData(m.payment),
    })),
    matchLog: state.matchLog.map(e => ({
      ...e,
      payment: e.payment ? stripRawData(e.payment) : undefined,
    })),
  }
  await kvSet(STATE_KEY, clean)
}

export function getMatchId(entry: { mpPaymentId?: string }): string {
  return entry.mpPaymentId || ''
}

export function incrementMonthlyStats(state: AppState, amount: number): void {
  const key = new Date().toISOString().slice(0, 7) // "YYYY-MM"
  const prev = state.monthlyStats[key] || { count: 0, volume: 0 }
  state.monthlyStats[key] = { count: prev.count + 1, volume: prev.volume + amount }
}
