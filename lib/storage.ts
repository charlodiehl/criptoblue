import { createClient } from '@supabase/supabase-js'
import type { AppState, Store } from './types'

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
  pendingMatches: [],
  unmatchedPayments: [],
  lastMPCheck: '',
  settings: {},
}

export async function getStores(): Promise<Record<string, Store>> {
  const stores = await kvGet<Record<string, Store>>(STORES_KEY)
  return stores || {}
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
    pendingMatches: state.pendingMatches || [],
    unmatchedPayments: state.unmatchedPayments || [],
  }
}

export async function saveState(state: AppState): Promise<void> {
  if (state.matchLog.length > 500) {
    state.matchLog = state.matchLog.slice(-500)
  }
  if (state.processedPayments.length > 2000) {
    state.processedPayments = state.processedPayments.slice(-2000)
  }
  await kvSet(STATE_KEY, state)
}

export function getMatchId(entry: { mpPaymentId?: string }): string {
  return entry.mpPaymentId || ''
}
