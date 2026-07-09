// ─────────────────────────────────────────────────────────────
// Capa de datos del registro — tabla relacional `registro_log`.
// Reemplaza el blob JSONB `criptoblue:logs.registroLog` y el blob
// `criptoblue:match-log` (retirado). Fuente única de verdad del registro.
// ─────────────────────────────────────────────────────────────
import type { LogEntry, Payment, Order } from './types'
import { getClient } from './storage'
import { registrarIngresoOrden } from './balance'
import { BALANCE_CUTOFF } from './config'

const TABLE = 'registro_log'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function stripRawData(payment: Payment): Payment {
  return { ...payment, rawData: {} }
}

function entryToRow(e: LogEntry): Row {
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
    payment: e.payment ? stripRawData(e.payment) : null,
    order_data: e.order ?? null,
  }
}

function rowToEntry(r: Row): LogEntry {
  return {
    timestamp: r.ts,
    action: r.action,
    source: r.source ?? undefined,
    triggeredBy: r.triggered_by ?? undefined,
    score: r.score ?? undefined,
    amount: r.amount ?? undefined,
    orderTotal: r.order_total ?? undefined,
    orderNumber: r.order_number ?? undefined,
    orderId: r.order_id ?? undefined,
    storeId: r.store_id ?? undefined,
    storeName: r.store_name ?? undefined,
    customerName: r.customer_name ?? undefined,
    cuitPagador: r.cuit_pagador ?? undefined,
    mpPaymentId: r.mp_payment_id ?? undefined,
    paymentReceivedAt: r.payment_received_at ?? undefined,
    orderCreatedAt: r.order_created_at ?? undefined,
    hidden: r.hidden ?? undefined,
    copiedAt: r.copied_at ?? undefined,
    payment: (r.payment as Payment) ?? undefined,
    order: (r.order_data as Order) ?? undefined,
  }
}

// ─────────────────────────────────────────────
// Escritura
// ─────────────────────────────────────────────

export async function appendRegistroEntry(entry: LogEntry): Promise<void> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any).insert(entryToRow(entry)).select('id').single()
  if (error) throw new Error(`appendRegistroEntry falló: ${error.message} [${error.code}]`)
  await registrarIngresoBestEffort(data?.id ?? null, entry)
}

export async function appendRegistroEntries(entries: LogEntry[]): Promise<void> {
  if (!entries.length) return
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any).insert(entries.map(entryToRow)).select('id')
  if (error) throw new Error(`appendRegistroEntries falló: ${error.message} [${error.code}]`)
  // PostgREST devuelve las filas insertadas en el orden de entrada → data[i] ↔ entries[i]
  for (let i = 0; i < entries.length; i++) {
    await registrarIngresoBestEffort(data?.[i]?.id ?? null, entries[i])
  }
}

// Hook de balance: cada orden registrada como pagada (auto o manual) genera su
// movimiento de ingreso en balance_movements. BEST-EFFORT a propósito: un fallo
// acá NUNCA debe impedir que el pago quede asentado en el registro (fuente de
// verdad). Un ingreso faltante se detecta y reconstruye por ref_registro_id.
async function registrarIngresoBestEffort(registroId: number | null, entry: LogEntry): Promise<void> {
  if (entry.action !== 'auto_paid' && entry.action !== 'manual_paid') return
  if (!entry.storeId) return
  try {
    await registrarIngresoOrden(registroId, entry)
  } catch (err) {
    console.error('[balance] no se pudo registrar el ingreso del movimiento:', err)
  }
}

// ─────────────────────────────────────────────
// Lectura paginada (para la UI del registro)
// ─────────────────────────────────────────────

export async function queryRegistro(opts: {
  limit?: number
  offset?: number
  month?: string          // 'YYYY-MM' en horario Argentina
  includeHidden?: boolean
} = {}): Promise<{ entries: LogEntry[]; total: number; hasMore: boolean }> {
  const supabase = getClient()
  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from(TABLE) as any).select('*', { count: 'exact' })
  if (!opts.includeHidden) q = q.eq('hidden', false)
  if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const start = new Date(`${opts.month}-01T00:00:00-03:00`)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    q = q.gte('ts', start.toISOString()).lt('ts', end.toISOString())
  }
  q = q.order('ts', { ascending: false }).range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`queryRegistro falló: ${error.message} [${error.code}]`)
  const total = count ?? 0
  return {
    entries: (data ?? []).map(rowToEntry),
    total,
    hasMore: offset + (data?.length ?? 0) < total,
  }
}

// ─────────────────────────────────────────────
// Registro paginado del lado del servidor (pestaña Registro)
// 100 por página, búsqueda global sobre toda la historia, orden global.
// Filtra a las acciones que la UI del registro muestra (paid + no_match).
// ─────────────────────────────────────────────

export type RegistroSortKey = 'fecha' | 'monto' | 'cuit' | 'nombre' | 'tienda' | 'orden' | 'billetera'

const REGISTRO_SORT_COLUMN: Record<RegistroSortKey, string> = {
  fecha: 'payment_received_at',
  monto: 'amount',
  cuit: 'cuit_pagador',
  nombre: 'customer_name',
  tienda: 'store_name',
  orden: 'order_number',
  billetera: 'payment->>source',
}

// Acciones que la pestaña Registro muestra (espejo del filtro client-side viejo)
const REGISTRO_VIEW_ACTIONS = ['manual_paid', 'auto_paid', 'no_match']

export type RegistroQueryOpts = {
  page?: number
  pageSize?: number
  month?: string          // 'YYYY-MM' AR — se ignora si hay search (búsqueda global)
  search?: string
  dateFrom?: string       // 'YYYY-MM-DD' AR (inclusive)
  dateTo?: string         // 'YYYY-MM-DD' AR (inclusive, hasta fin del día)
  sortKey?: RegistroSortKey
  sortDir?: 'asc' | 'desc'
  includeHidden?: boolean
}

// Aplica los filtros comunes (acción, hidden, búsqueda/mes, rango de fechas) a un
// query builder de supabase-js. La búsqueda es global (ignora el mes).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRegistroFilters(q: any, opts: RegistroQueryOpts): any {
  if (!opts.includeHidden) q = q.eq('hidden', false)
  q = q.in('action', REGISTRO_VIEW_ACTIONS)

  const search = (opts.search ?? '').trim()
  if (search) {
    // Saneamos para no romper la sintaxis de PostgREST or() (separador `,` y paréntesis)
    const safe = search.replace(/[,()]/g, ' ').trim()
    const pat = `*${safe}*`
    const ors = [
      `order_number.ilike.${pat}`,
      `customer_name.ilike.${pat}`,
      `store_name.ilike.${pat}`,
      `cuit_pagador.ilike.${pat}`,
      `mp_payment_id.ilike.${pat}`,
      `payment->>nombrePagador.ilike.${pat}`,
    ]
    if (/^\d+(\.\d+)?$/.test(safe)) ors.push(`amount.eq.${Number(safe)}`)
    q = q.or(ors.join(','))
    // search es global: NO se filtra por mes
  } else if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const start = new Date(`${opts.month}-01T00:00:00-03:00`)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    q = q.gte('ts', start.toISOString()).lt('ts', end.toISOString())
  }

  if (opts.dateFrom) {
    const from = new Date(`${opts.dateFrom}T00:00:00.000-03:00`)
    if (!Number.isNaN(from.getTime())) q = q.gte('ts', from.toISOString())
  }
  if (opts.dateTo) {
    const to = new Date(`${opts.dateTo}T23:59:59.999-03:00`)
    if (!Number.isNaN(to.getTime())) q = q.lte('ts', to.toISOString())
  }
  return q
}

export async function queryRegistroPaged(opts: RegistroQueryOpts = {}): Promise<{
  entries: LogEntry[]; total: number; newCount: number; page: number; pageSize: number; hasMore: boolean
}> {
  const supabase = getClient()
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = opts.pageSize ?? 100
  const offset = (page - 1) * pageSize

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from(TABLE) as any).select('*', { count: 'exact' })
  q = applyRegistroFilters(q, opts)
  const sortKey = opts.sortKey ?? 'fecha'
  const col = REGISTRO_SORT_COLUMN[sortKey] ?? 'ts'
  const ascending = opts.sortDir === 'asc'
  q = q.order(col, { ascending, nullsFirst: false })
  if (col !== 'ts') q = q.order('ts', { ascending: false }) // tie-breaker estable
  q = q.range(offset, offset + pageSize - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`queryRegistroPaged falló: ${error.message} [${error.code}]`)
  const total = count ?? 0

  // Conteo global de pendientes (sin copiar) con los mismos filtros — para "Copiar nuevos"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nc = (supabase.from(TABLE) as any).select('id', { count: 'exact', head: true })
  nc = applyRegistroFilters(nc, opts).is('copied_at', null)
  const { count: newCount, error: ncErr } = await nc
  if (ncErr) throw new Error(`queryRegistroPaged(newCount) falló: ${ncErr.message} [${ncErr.code}]`)

  return {
    entries: (data ?? []).map(rowToEntry),
    total,
    newCount: newCount ?? 0,
    page,
    pageSize,
    hasMore: offset + (data?.length ?? 0) < total,
  }
}

// Trae TODAS las entradas sin copiar que cumplen los filtros (para "Copiar nuevos").
// Pendientes = working set chico en la práctica; paginamos por las dudas, con tope de seguridad.
export async function queryRegistroUncopied(opts: RegistroQueryOpts = {}): Promise<LogEntry[]> {
  const supabase = getClient()
  const out: LogEntry[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from(TABLE) as any).select('*')
    q = applyRegistroFilters(q, opts).is('copied_at', null)
    q = q.order('ts', { ascending: false }).range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(`queryRegistroUncopied falló: ${error.message} [${error.code}]`)
    const rows = (data ?? []) as Row[]
    out.push(...rows.map(rowToEntry))
    if (rows.length < PAGE) break
    from += PAGE
    if (from > 50000) break // tope de seguridad
  }
  return out
}

// Meses disponibles para el selector (derivados en JS desde la columna ts).
// Se evita un RPC SQL para no depender de DDL: paginamos solo la columna `ts`
// y agrupamos por mes en horario Argentina (UTC-3). Devuelve 'YYYY-MM' desc.
export async function getRegistroMonths(): Promise<string[]> {
  const supabase = getClient()
  const months = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(TABLE) as any)
      .select('ts')
      .order('ts', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getRegistroMonths falló: ${error.message} [${error.code}]`)
    const rows = (data ?? []) as { ts: string }[]
    for (const r of rows) {
      const ms = new Date(r.ts).getTime()
      if (!Number.isFinite(ms)) continue
      // Bucket por mes en horario Argentina (UTC-3)
      months.add(new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 7))
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return Array.from(months).sort((a, b) => (a < b ? 1 : -1))
}

// ─────────────────────────────────────────────
// Dedup / confirmedIds (para cycle.ts y auto-match-runner)
// Devuelve marcas confirmadas; el caller arma los Sets que necesite.
// sinceMs acota la ventana (default 45 días — cubre de sobra los pagos en proceso).
// ─────────────────────────────────────────────

export type ConfirmedMark = {
  mpPaymentId?: string
  orderId?: string
  storeId?: string
  action: string
}

const CONFIRMED_WINDOW_MS = 45 * 24 * 60 * 60 * 1000

export async function getConfirmedMarks(sinceMs?: number): Promise<ConfirmedMark[]> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs ?? Date.now() - CONFIRMED_WINDOW_MS).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('mp_payment_id, order_id, store_id, action')
    .in('action', ['manual_paid', 'auto_paid', 'dismissed'])
    .eq('hidden', false)
    .gte('ts', cutoff)
  if (error) throw new Error(`getConfirmedMarks falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({
    mpPaymentId: r.mp_payment_id ?? undefined,
    orderId: r.order_id ?? undefined,
    storeId: r.store_id ?? undefined,
    action: r.action,
  }))
}

// Validaciones puntuales de duplicado (reemplazan los .some() sobre el blob)
export async function isOrderAlreadyPaid(orderId: string): Promise<boolean> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase.from(TABLE) as any)
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
  if (error) throw new Error(`isOrderAlreadyPaid falló: ${error.message} [${error.code}]`)
  return (count ?? 0) > 0
}

// Trae monto/fecha/nombre de los pagos ya registrados de una billetera (source),
// para deduplicar por firma al cargar una planilla. Paginado.
export async function getRegistroPaymentsBySource(source: string): Promise<{ monto: number | null; fecha: string; nombre: string }[]> {
  const supabase = getClient()
  const out: { monto: number | null; fecha: string; nombre: string }[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(TABLE) as any)
      .select('amount, payment')
      .eq('payment->>source', source)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getRegistroPaymentsBySource falló: ${error.message} [${error.code}]`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      const p = r.payment ?? {}
      out.push({ monto: p.monto ?? r.amount ?? null, fecha: p.fechaPago ?? '', nombre: p.nombrePagador ?? '' })
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Source del pago (billetera) con el que se emparejó una orden — para atribuir el
// reembolso a la billetera de la que vino el dinero. Devuelve el source del match
// más reciente de esa orden, o null si no hay registro (orden no emparejada en la app).
export async function getWalletSourceByOrder(storeId: string, orderNumber: string): Promise<string | null> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('source:payment->>source')
    .eq('store_id', storeId)
    .eq('order_number', String(orderNumber))
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getWalletSourceByOrder falló: ${error.message} [${error.code}]`)
  return data?.source ?? null
}

export async function isPaymentAlreadyUsed(mpPaymentId: string): Promise<boolean> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase.from(TABLE) as any)
    .select('id', { count: 'exact', head: true })
    .eq('mp_payment_id', mpPaymentId)
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
  if (error) throw new Error(`isPaymentAlreadyUsed falló: ${error.message} [${error.code}]`)
  return (count ?? 0) > 0
}

// Búsqueda de duplicados por identidad en una ventana (para buscar-orden).
// Devuelve entradas con order_id que matcheen la tienda y la ventana temporal.
export async function findRegistroByStoreSince(storeId: string, sinceMs: number): Promise<LogEntry[]> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('*')
    .eq('store_id', storeId)
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
    .gte('ts', cutoff)
  if (error) throw new Error(`findRegistroByStoreSince falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToEntry)
}

// Órdenes pagadas de una tienda en un día ART ('YYYY-MM-DD'), con el id de la fila
// para poder cruzar con balance_movements (ref_registro_id). Usada por el portal
// de tienda (pestaña Balance). Argentina es UTC-3 fijo.
export async function queryRegistroByStoreDay(
  storeId: string, diaART: string,
): Promise<Array<{ registroId: number; entry: LogEntry }>> {
  const supabase = getClient()
  const diaDesde = new Date(`${diaART}T00:00:00-03:00`).getTime()
  const hasta = new Date(diaDesde + 24 * 60 * 60 * 1000).toISOString()
  // Límite inferior efectivo: nunca antes del corte del balance (coherente con el
  // saldo, que solo cuenta órdenes desde BALANCE_CUTOFF).
  const desde = new Date(Math.max(diaDesde, BALANCE_CUTOFF.getTime())).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('*')
    .eq('store_id', storeId)
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
    .gte('ts', desde)
    .lt('ts', hasta)
    .order('ts', { ascending: false })
  if (error) throw new Error(`queryRegistroByStoreDay falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({ registroId: r.id as number, entry: rowToEntry(r) }))
}

// Búsqueda de órdenes de una tienda en TODO su registro desde el corte (no por día),
// por N° de orden, nombre, CUIT o monto. Para la barra buscadora del portal.
export async function searchRegistroByStore(
  storeId: string, query: string, limit = 100,
): Promise<Array<{ registroId: number; entry: LogEntry }>> {
  const supabase = getClient()
  const q = (query ?? '').trim().replace(/[,()]/g, ' ').trim()
  if (!q) return []
  const desde = BALANCE_CUTOFF.toISOString()
  const pat = `*${q}*`
  const ors = [
    `order_number.ilike.${pat}`,
    `customer_name.ilike.${pat}`,
    `cuit_pagador.ilike.${pat}`,
    `payment->>nombrePagador.ilike.${pat}`,
  ]
  if (/^\d+(\.\d+)?$/.test(q)) ors.push(`amount.eq.${Number(q)}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('*')
    .eq('store_id', storeId)
    .eq('hidden', false)
    .in('action', ['manual_paid', 'auto_paid'])
    .gte('ts', desde)
    .or(ors.join(','))
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`searchRegistroByStore falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({ registroId: r.id as number, entry: rowToEntry(r) }))
}

// Reclamos de pagos hechos por tiendas (source='tienda_buscar') en una ventana.
// Alimenta el feed informativo de Administración General (solo lectura).
export async function getReclamosRecientes(
  sinceMs: number,
): Promise<Array<{ timestamp: string; storeId: string; storeName: string; amount: number; orderNumber: string }>> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('ts, store_id, store_name, amount, order_number')
    .eq('source', 'tienda_buscar')
    .eq('hidden', false)
    .gte('ts', cutoff)
    .order('ts', { ascending: false })
  if (error) throw new Error(`getReclamosRecientes falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({
    timestamp: r.ts,
    storeId: r.store_id ?? '',
    storeName: r.store_name ?? '',
    amount: Number(r.amount) || 0,
    orderNumber: r.order_number ?? '',
  }))
}

// ─────────────────────────────────────────────
// Edición / marcado (para /api/log PATCH)
// ─────────────────────────────────────────────

export type RegistroEdit = {
  customerName?: string
  cuit?: string
  orderNumber?: string
  storeName?: string
  hidden?: boolean
}

// Edita una entrada identificada por su timestamp. Aplica cambios a las columnas
// top-level y a los sub-campos de los JSONB payment/order (espejo de applyEdit viejo).
export async function updateRegistroByTimestamp(timestamp: string, edit: RegistroEdit): Promise<boolean> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: selErr } = await (supabase.from(TABLE) as any)
    .select('*')
    .eq('ts', timestamp)
  if (selErr) throw new Error(`updateRegistroByTimestamp(select) falló: ${selErr.message} [${selErr.code}]`)
  if (!rows || rows.length === 0) return false

  for (const row of rows as Row[]) {
    const patch: Row = {}
    const payment = row.payment ? { ...row.payment } : null
    const orderData = row.order_data ? { ...row.order_data } : null

    if (edit.customerName !== undefined) {
      patch.customer_name = edit.customerName
      if (payment) payment.nombrePagador = edit.customerName
    }
    if (edit.cuit !== undefined) {
      if (payment) payment.cuitPagador = edit.cuit
    }
    if (edit.orderNumber !== undefined) {
      patch.order_number = edit.orderNumber
      if (orderData) orderData.orderNumber = edit.orderNumber
    }
    if (edit.storeName !== undefined) {
      patch.store_name = edit.storeName
      if (orderData) orderData.storeName = edit.storeName
    }
    if (edit.hidden !== undefined) {
      patch.hidden = edit.hidden
    }
    if (payment) patch.payment = payment
    if (orderData) patch.order_data = orderData

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabase.from(TABLE) as any).update(patch).eq('id', row.id)
    if (updErr) throw new Error(`updateRegistroByTimestamp(update) falló: ${updErr.message} [${updErr.code}]`)
  }
  return true
}

// Marca como copiadas (copied_at = ahora) las entradas con los timestamps dados.
export async function markRegistroCopied(timestamps: string[]): Promise<void> {
  if (!timestamps.length) return
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(TABLE) as any)
    .update({ copied_at: new Date().toISOString() })
    .in('ts', timestamps)
  if (error) throw new Error(`markRegistroCopied falló: ${error.message} [${error.code}]`)
}
