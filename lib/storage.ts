import { createClient } from '@supabase/supabase-js'
import type { AppState, Store, Payment, Order, UnmatchedPayment, RecentMatch, DismissedPair, ExternalPaymentMark, PersistedMonthStats, ErrorEntry, ActivityEntry } from './types'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS, WALLETS_SIN_VENCIMIENTO } from './config'
import { nowART, monthKeyART, paymentWalletId } from './utils'

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
export function getClient() {
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
const STORES_KEY     = 'criptoblue:stores'
const LOCK_KEY       = 'criptoblue:lock'
const CRON_PAUSED_KEY = 'criptoblue:cron-paused'

// NOTA: el registro (antes registroLog en criptoblue:logs y el blob
// criptoblue:match-log) vive ahora en la tabla relacional `registro_log`
// (ver lib/registro.ts). criptoblue:logs conserva solo errorLog + activityLog.

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
  errorLog: ErrorEntry[]
  activityLog: ActivityEntry[]
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
  errorLog: [],
  activityLog: [],
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

export async function kvGet<T>(key: string): Promise<T | null> {
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

export async function kvSet(key: string, value: unknown): Promise<void> {
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
      // Notificación ligera para Realtime — fire-and-forget (~60 bytes vs ~100KB del row completo)
      notifyKeyUpdate(key).catch(() => {})
      return
    } catch (e) {
      if (i === intentos - 1) throw e
      await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
}

// Upsert mínimo en kv_notifications para disparar evento Realtime sin enviar el blob completo
async function notifyKeyUpdate(key: string): Promise<void> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('kv_notifications') as any)
    .upsert({ key, notified_at: new Date().toISOString() })
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

// Pagos de billeteras "sin vencimiento" (MF, Lacar, MS): se conservan indefinidamente
// mientras sigan sin marcar como externos. Al marcarse, vuelven al vencimiento normal.
// Usada tanto en cleanHotData como en el merge-protector de saveHotState — deben
// coincidir, si no un guardado que parta de una cola vacía (ej. reevaluar) puede
// perder estos pagos porque el merge los descarta por "viejos" sin mirar la billetera.
function esNuncaVence(u: UnmatchedPayment, externallyMarkedIds: Set<string>): boolean {
  const wallet = paymentWalletId(u.payment.source)
  const id = u.mpPaymentId || u.payment.mpPaymentId
  return !!wallet && WALLETS_SIN_VENCIMIENTO.includes(wallet) && !externallyMarkedIds.has(id)
}

// Lógica de limpieza compartida entre saveHotState y saveState (#8)
function cleanHotData(state: HotState): HotState {
  const { cutoff48hMs, effectiveCutoffPaymentsMs, effectiveCutoffMinMs } = getCutoffs()
  const externallyMarkedIds = new Set((state.externallyMarkedPayments ?? []).map(e => e.id))
  const cleaned: HotState = {
    ...state,
    // Filtro temporal (48h) + cap duro (2000) como defense-in-depth.
    // Si el filtro temporal alguna vez falla (race condition, write fallido, etc),
    // el cap garantiza que el array no crezca indefinidamente. Consistente con
    // los caps duros que ya tienen retainedPaymentIds (1000) y externallyMarkedOrders (500).
    recentMatches: (state.recentMatches ?? [])
      .filter(m => new Date(m.matchedAt).getTime() >= effectiveCutoffMinMs)
      .slice(-2000),
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
      .filter(u => !u.payment.fechaPago || new Date(u.payment.fechaPago).getTime() >= effectiveCutoffPaymentsMs || esNuncaVence(u, externallyMarkedIds))
      .map(u => ({ ...u, payment: stripRawData(u.payment) })),
  }

  // Limpiar paymentOverrides de pagos que ya no están en unmatchedPayments (#M3)
  // IMPORTANTE: solo limpiar si hay pagos activos. Si la cola está vacía (ej: reset
  // intencional en reevaluar), preservar todos los overrides para que se re-apliquen
  // cuando processMPPayments reconstruya la cola en el mismo ciclo.
  if (cleaned.paymentOverrides && Object.keys(cleaned.paymentOverrides).length > 0 && cleaned.unmatchedPayments.length > 0) {
    const activeIds = new Set(cleaned.unmatchedPayments.map(u => u.payment.mpPaymentId))
    for (const id of Object.keys(cleaned.paymentOverrides)) {
      if (!activeIds.has(id)) delete cleaned.paymentOverrides[id]
    }
  }

  return cleaned
}

// Union-merge genérico por campo único (para errorLog/activityLog)
function mergeByField<T extends { id: string }>(incoming: T[], current: T[]): T[] {
  const incomingIds = new Set(incoming.map(e => e.id))
  const merged = [...incoming]
  for (const entry of current) {
    if (!incomingIds.has(entry.id)) {
      merged.push(entry)
    }
  }
  return merged
}

function cleanLogsData(state: LogsState): LogsState {
  const { cutoff7dMs, cutoff30dMs } = getCutoffs()
  return {
    errorLog: (state.errorLog ?? [])
      .filter(e => !e.resolved || new Date(e.timestamp).getTime() >= cutoff7dMs)
      .slice(-500),
    activityLog: (state.activityLog ?? [])
      .filter(e => new Date(e.timestamp).getTime() >= cutoff30dMs)
      .slice(-1000),
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
    errorLog: data.errorLog ?? [],
    activityLog: data.activityLog ?? [],
  }
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
  if (current) {
    // Merge paymentOverrides — preservar overrides de procesos concurrentes
    if (current.paymentOverrides && Object.keys(current.paymentOverrides).length > 0) {
      const activeIds = new Set(cleaned.unmatchedPayments.map(u => u.payment.mpPaymentId))
      for (const [id, override] of Object.entries(current.paymentOverrides)) {
        if (activeIds.has(id) && !cleaned.paymentOverrides[id]) {
          cleaned.paymentOverrides[id] = override
        }
      }
    }

    // Merge dismissedPairs — preservar dismisses de procesos concurrentes
    if (current.dismissedPairs?.length) {
      const existingKeys = new Set(
        (cleaned.dismissedPairs ?? []).map(p => `${p.mpPaymentId}|${p.orderId}|${p.storeId}`)
      )
      for (const pair of current.dismissedPairs) {
        const key = `${pair.mpPaymentId}|${pair.orderId}|${pair.storeId}`
        if (!existingKeys.has(key)) {
          cleaned.dismissedPairs = cleaned.dismissedPairs ?? []
          cleaned.dismissedPairs.push(pair)
        }
      }
    }

    // Merge externallyMarkedOrders — preservar marcados de procesos concurrentes
    if (current.externallyMarkedOrders?.length) {
      const existingOrders = new Set(cleaned.externallyMarkedOrders ?? [])
      for (const key of current.externallyMarkedOrders) {
        if (!existingOrders.has(key)) {
          cleaned.externallyMarkedOrders = cleaned.externallyMarkedOrders ?? []
          cleaned.externallyMarkedOrders.push(key)
        }
      }
    }

    // Merge externallyMarkedPayments — preservar marcados de procesos concurrentes
    if (current.externallyMarkedPayments?.length) {
      const existingIds = new Set((cleaned.externallyMarkedPayments ?? []).map(e => e.id))
      for (const entry of current.externallyMarkedPayments) {
        if (!existingIds.has(entry.id)) {
          cleaned.externallyMarkedPayments = cleaned.externallyMarkedPayments ?? []
          cleaned.externallyMarkedPayments.push(entry)
        }
      }
    }

    // Merge recentMatches — preservar matches manuales agregados por procesos concurrentes.
    // Sin esto, si el cron carga el estado ANTES de que manual-match guarde, su versión
    // de recentMatches no tiene el nuevo match y lo sobreescribe al guardar — borrando
    // la entrada. Consecuencia: el pago matcheado reaparece en la cola (no está en
    // confirmedByRecentMatch) y el badge del frontend no lo filtra. Caso real: pagos
    // 157055175149 y 158008514494 el 7/5.
    //
    // IMPORTANTE: solo mergear entradas dentro de la ventana de 48h (effectiveCutoffMinMs).
    // Sin este filtro, el merge re-agregaba entries viejos que cleanHotData ya había
    // filtrado de cleaned.recentMatches, anulando la limpieza temporal y dejando que
    // el array creciera indefinidamente (caso real: 1.789 entradas acumuladas de 7 días).
    if (current.recentMatches?.length) {
      const { effectiveCutoffMinMs } = getCutoffs()
      const cleanedMatchIds = new Set((cleaned.recentMatches ?? []).map(m => m.mpPaymentId))
      for (const m of current.recentMatches) {
        if (new Date(m.matchedAt).getTime() < effectiveCutoffMinMs) continue
        if (m.mpPaymentId && !cleanedMatchIds.has(m.mpPaymentId)) {
          cleaned.recentMatches = cleaned.recentMatches ?? []
          cleaned.recentMatches.push(m)
        }
      }
    }

    // Excluir de cleaned.unmatchedPayments los pagos que OTRO proceso ya confirmó
    // (aparecen en cleaned.recentMatches, ya mergeado arriba). Sin esto, el cron puede
    // re-agregar un pago que manual-match removió entre el load y el save del cron:
    // el cron tenía el pago en su versión inicial, y el merge de unmatchedPayments
    // solo AGREGA lo que falta en current — no QUITA lo que el manual-match removió.
    if (cleaned.recentMatches?.length) {
      const allMatchedIds = new Set(cleaned.recentMatches.map(m => m.mpPaymentId).filter(Boolean))
      cleaned.unmatchedPayments = cleaned.unmatchedPayments.filter(
        u => !allMatchedIds.has(u.payment.mpPaymentId)
      )
    }

    // Merge unmatchedPayments — preservar pagos agregados por procesos concurrentes.
    // Escenario crítico: endpoint X carga hot state en T0, el cron agrega pagos nuevos
    // y guarda en T1, endpoint X guarda en T2 con su versión T0 de unmatchedPayments,
    // sobreescribiendo los pagos del cron. Sin este merge, esos pagos se pierden silenciosamente.
    //
    // Exclusión 1: un pago emparejado (auto o manual) SIEMPRE se agrega a recentMatches
    // al mismo tiempo que se remueve de unmatchedPayments. Usamos cleaned.recentMatches
    // (ya mergeado arriba) como lista de exclusión para no re-agregar pagos ya emparejados.
    //
    // Exclusión 2: pagos cuya fechaPago está fuera de la ventana de retención
    // (effectiveCutoffPaymentsMs). Sin esto, el merge re-agrega pagos que el cron
    // intencionalmente purgó por antigüedad, infinitamente. Caso real: 1.560 pagos
    // de hace 24 días seguían vivos porque el merge los reincorporaba en cada save.
    // Excepción: pagos "sin vencimiento" (esNuncaVence) igual se preservan aunque
    // sean viejos — si no, un guardado que parte de cola vacía (ej. Fase 1 de
    // /api/reevaluar) los pierde para siempre, ya que sus fuentes (Fiwind/Lacar/
    // Notificador) no se re-obtienen como los pagos de Mercado Pago.
    if (current.unmatchedPayments?.length) {
      const existingIds = new Set(cleaned.unmatchedPayments.map(u => u.payment.mpPaymentId))
      const confirmedByRecentMatch = new Set((cleaned.recentMatches ?? []).map(m => m.mpPaymentId))
      const { effectiveCutoffPaymentsMs } = getCutoffs()
      const externallyMarkedIds = new Set((cleaned.externallyMarkedPayments ?? []).map(e => e.id))
      for (const u of current.unmatchedPayments) {
        const id = u.payment.mpPaymentId
        if (existingIds.has(id) || confirmedByRecentMatch.has(id)) continue
        // Respetar el cutoff de purga: pagos viejos no deben re-aparecer (salvo nuncaVence)
        const fp = u.payment.fechaPago ? new Date(u.payment.fechaPago).getTime() : null
        if (fp !== null && Number.isFinite(fp) && fp < effectiveCutoffPaymentsMs && !esNuncaVence(u, externallyMarkedIds)) continue
        cleaned.unmatchedPayments.push({ ...u, payment: stripRawData(u.payment) })
      }
    }
  }

  await kvSetConRetry(HOT_KEY, cleaned)
}

export async function saveLogs(state: LogsState): Promise<void> {
  // criptoblue:logs conserva solo errorLog + activityLog. El registro vive
  // en la tabla registro_log (ver lib/registro.ts).
  // Merge con Supabase para no perder entradas escritas por procesos concurrentes.
  const current = await kvGet<LogsState>(LOGS_KEY)
  const mergedState: LogsState = current
    ? cleanLogsData({
        errorLog: mergeByField(state.errorLog, current.errorLog ?? []),
        activityLog: mergeByField(state.activityLog, current.activityLog ?? []),
      })
    : cleanLogsData({
        errorLog: state.errorLog ?? [],
        activityLog: state.activityLog ?? [],
      })

  await kvSetConRetry(LOGS_KEY, mergedState)
}

export async function saveProcessed(state: ProcessedState): Promise<void> {
  await kvSetConRetry(PROCESSED_KEY, cleanProcessedData(state))
}

export async function saveOrdersCache(state: OrdersCacheState): Promise<void> {
  await kvSetConRetry(ORDERS_KEY, state)
}

// ─────────────────────────────────────────────
// Pausa del cron — flag en kv_store leído por /api/run.
// Se prende/apaga con SQL durante la migración. Instantáneo, sin redeploy.
// ─────────────────────────────────────────────

export async function isCronPaused(): Promise<boolean> {
  try {
    const val = await kvGet<unknown>(CRON_PAUSED_KEY)
    return val === true || val === 'true'
  } catch {
    // Si la lectura falla, NO pausar — preferir que el cron siga corriendo
    return false
  }
}

// ─────────────────────────────────────────────
// loadState / saveState — carga y guarda todo (usado por cycle.ts)
// ─────────────────────────────────────────────

export async function loadState(): Promise<AppState> {
  const [hot, logs, processed, orders] = await Promise.all([
    loadHotState(),
    loadLogs(),
    loadProcessed(),
    loadOrdersCache(),
  ])

  return {
    ...hot,
    ...logs,
    ...processed,
    cachedOrders: orders.cachedOrders,
    cachedOrdersAt: orders.cachedOrdersAt, // fuente de verdad: OrdersCacheState (#5)
  }
}

export async function saveState(state: AppState): Promise<void> {
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

  const cycleLogs: LogsState = {
    errorLog: state.errorLog ?? [],
    activityLog: state.activityLog ?? [],
  }

  const processed = cleanProcessedData({ processedPayments: state.processedPayments ?? [] })

  const orders: OrdersCacheState = {
    cachedOrders: state.cachedOrders ?? [],
    cachedOrdersAt: state.cachedOrdersAt ?? '',
  }

  // Usar saveLogs() en vez de escribir directamente — hace su propio read+merge
  // justo antes de escribir, evitando race conditions con escrituras concurrentes.
  //
  // CRÍTICO: processedPayments se guarda DESPUÉS de saveHotState y los demás.
  // Si saveHotState falla (kvSetConRetry agota reintentos), processedPayments
  // NO debe quedar actualizado — de lo contrario el pago queda fantasma:
  // marcado como procesado pero nunca agregado al queue ni a los logs, y los
  // ciclos siguientes lo filtran por estar en processedSet.
  // El próximo ciclo re-fetcha el pago y lo procesa de nuevo. El merge de
  // saveHotState deduplica por mpPaymentId si por alguna razón ya estaba.
  await Promise.all([
    saveHotState(hotInput),
    saveLogs(cycleLogs),
    kvSetConRetry(ORDERS_KEY, orders),
  ])
  await kvSetConRetry(PROCESSED_KEY, processed)
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
    timestamp: nowART(),
    source,
    level,
    message,
    context,
    resolved: false,
    seen: false,
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
    timestamp: nowART(),
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
  const key = monthKeyART()
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

// ─────────────────────────────────────────────
// Lock global — exclusión mutua para operaciones de marcado
// Usa un key dedicado en kv_store para no interferir con merge de HotState.
// Timeout de seguridad: si un request falla sin liberar, el lock expira automáticamente.
// ─────────────────────────────────────────────

export type LockState = {
  lockId: string      // ID único para verificación atómica (write-then-verify)
  holder: string      // 'manual-match' | 'auto-match' | 'cycle' | 'reevaluar' | etc.
  acquiredAt: string  // ISO timestamp
  detail?: string     // info adicional (ej: "orden #70786")
}

const DEFAULT_LOCK_TIMEOUT_MS = 30_000 // 30 segundos

// Patrón write-then-verify: escribe el lock con un ID único, luego lee para confirmar
// que nuestra escritura ganó. Si otro proceso escribió entre medio, el ID no coincide
// y sabemos que perdimos la carrera. Esto elimina la race condition del read-then-write.
export async function acquireLock(
  holder: string,
  detail?: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): Promise<boolean> {
  // Paso 1: verificar si hay lock activo
  const current = await kvGet<LockState>(LOCK_KEY)
  if (current?.acquiredAt) {
    const age = Date.now() - new Date(current.acquiredAt).getTime()
    if (age < timeoutMs) {
      return false // Lock activo y no expirado
    }
  }

  // Paso 2: escribir nuestro lock con ID único
  const lockId = `${holder}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const lock: LockState = { lockId, holder, acquiredAt: new Date().toISOString(), detail }
  await kvSet(LOCK_KEY, lock)

  // Paso 3: leer de vuelta y verificar que nuestro ID ganó
  const verify = await kvGet<LockState>(LOCK_KEY)
  if (verify?.lockId === lockId) {
    return true // Nuestro write ganó
  }

  // Otro proceso escribió entre medio — no tenemos el lock
  return false
}

export async function releaseLock(holder: string): Promise<void> {
  try {
    const current = await kvGet<LockState>(LOCK_KEY)
    if (current?.holder === holder) {
      await kvSet(LOCK_KEY, {}) // {} en vez de null — kv_store tiene NOT NULL en value
    }
  } catch {
    // Si falla la liberación, el lock expirará por timeout (30s)
  }
}

export async function getLockState(): Promise<LockState | null> {
  const current = await kvGet<LockState>(LOCK_KEY)
  if (!current?.acquiredAt) return null
  const age = Date.now() - new Date(current.acquiredAt).getTime()
  if (age >= DEFAULT_LOCK_TIMEOUT_MS) return null // expirado
  return current
}

// Esperar hasta que el lock esté libre, con timeout máximo
export async function waitForLock(
  holder: string,
  detail?: string,
  maxWaitMs = 15_000,
  retryIntervalMs = 500,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const acquired = await acquireLock(holder, detail)
    if (acquired) return true
    await new Promise(r => setTimeout(r, retryIntervalMs))
  }
  return false
}
