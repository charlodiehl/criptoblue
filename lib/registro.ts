// ─────────────────────────────────────────────────────────────
// Capa de datos del registro — tabla relacional `registro_log`.
// Reemplaza el blob JSONB `criptoblue:logs.registroLog` y el blob
// `criptoblue:match-log` (retirado). Fuente única de verdad del registro.
// ─────────────────────────────────────────────────────────────
import type { LogEntry, Payment, Order } from './types'
import { getClient, kvGet, kvSet } from './storage'
import { registrarIngresoOrden, actualizarDescripcionIngreso } from './balance'
import { BALANCE_CUTOFF, SOURCE_SIN_BILLETERA } from './config'
import { billeteraLabel, billeteraIdentificada } from './utils'

const TABLE = 'registro_log'

// IDs de reclamos (pagos que una tienda se adjudicó) que el admin ya marcó como OK.
// Se guardan aparte del registro a propósito: el "OK" es estado del FEED del admin,
// no del pago — no debe tocar el registro, el hidden ni el balance.
const RECLAMOS_OK_KEY = 'criptoblue:reclamos-ok'

// Acciones que representan una orden efectivamente pagada.
const MATCHED_ACTIONS = ['manual_paid', 'auto_paid']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function stripRawData(payment: Payment): Payment {
  return { ...payment, rawData: {} }
}

// ─── SEGURO: todo pago del registro cae SIEMPRE en una billetera ──────────────
// Si la entrada no trae payment, o su source está vacío o no identifica ninguna
// billetera, se guarda bajo "Otras" (conservando el texto original como detalle).
// Va acá, en entryToRow, porque es la ÚNICA puerta por la que pasa todo lo que se
// escribe al registro: ningún flujo puede saltearlo. Antes, un pago sin billetera
// se descartaba en silencio de Administración Financiera (sumaba por tienda pero
// no por billetera) o se mostraba como "MercadoPago", que ni siquiera existe.
function conBilleteraSegura(e: LogEntry): LogEntry {
  if (e.action !== 'auto_paid' && e.action !== 'manual_paid') return e
  const raw = (e.payment?.source ?? '').trim()
  if (billeteraIdentificada(raw)) return e
  // No identificada → "Otras". Si había un texto suelto ("transferencia", "-"), se
  // conserva como nombre libre del cajón; si no había nada, "Sin identificar".
  const source = raw && raw !== '-' ? `otras:${raw}` : SOURCE_SIN_BILLETERA
  const payment: Payment = {
    ...(e.payment ?? {
      mpPaymentId: e.mpPaymentId ?? '',
      monto: e.amount ?? 0,
      nombrePagador: e.customerName ?? '',
      emailPagador: '',
      cuitPagador: e.cuitPagador ?? '',
      referencia: '',
      operationId: '',
      metodoPago: '',
      fechaPago: e.paymentReceivedAt ?? e.timestamp,
      status: 'approved',
      rawData: {},
    }),
    source,
  }
  return { ...e, payment }
}

function entryToRow(e0: LogEntry): Row {
  const e = conBilleteraSegura(e0)
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
    hecho_por: e.hechoPor ?? null,
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
    hechoPor: r.hecho_por ?? undefined,
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

// Inserta una entrada SIN el hook de balance (el caller crea el movimiento a mano,
// p. ej. con cotización manual en el saldo personalizado). Devuelve el id de la fila.
export async function insertRegistroEntry(entry: LogEntry): Promise<number> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any).insert(entryToRow(entry)).select('id').single()
  if (error) throw new Error(`insertRegistroEntry falló: ${error.message} [${error.code}]`)
  return data.id as number
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
  if (!entry.storeId) {
    // Un pago sin tienda no genera ingreso: no cuenta en la planilla ni en el saldo.
    // Se deja rastro para que nunca pase en silencio (bug del store_id null, 15/7).
    console.error(`[balance] registro #${registroId ?? '?'} pagado SIN storeId (tienda "${entry.storeName || '—'}"): no genera movimiento de saldo`)
    return
  }
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

// Reclama de forma ATÓMICA las entradas sin copiar que cumplen los filtros: las marca
// copiadas y devuelve exactamente las que ESTE llamador ganó. Es la única forma de
// copiar el registro.
//
// Por qué un claim y no leer-y-después-marcar: somos varios admins. Con dos pasos,
// dos admins que apretaban "Copiar" casi a la vez leían la misma lista y ambos la
// pegaban en la planilla general. Acá el `copied_at IS NULL` viaja DENTRO del UPDATE:
// en READ COMMITTED el segundo admin espera el lock de la fila, re-evalúa la condición
// sobre la versión ya marcada, no la matchea y no se la lleva. Cada entrada la gana
// exactamente uno.
//
// Se reclama por `id`, no por `ts`: no hay UNIQUE sobre `ts`, y marcar de más significa
// una orden que se da por copiada sin haber llegado nunca a la planilla.
//
// El UPDATE va en tandas chicas a propósito. Un `UPDATE … RETURNING` masivo marca
// TODAS las filas pero puede devolver solo las primeras si PostgREST trunca la
// respuesta: las marcadas-pero-no-devueltas se perderían en silencio. Con tandas de
// 200 la respuesta nunca se acerca al límite.
export async function claimRegistroUncopied(opts: RegistroQueryOpts = {}): Promise<{ entries: LogEntry[]; claimIds: number[] }> {
  const supabase = getClient()
  const BATCH = 200
  const PAGE = 1000

  // 1) Candidatas: las que hoy están sin copiar y pasan los filtros del admin.
  const candidatas = new Map<number, Row>()
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from(TABLE) as any).select('*')
    q = applyRegistroFilters(q, opts).is('copied_at', null)
    q = q.order('id', { ascending: true }).range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(`claimRegistroUncopied(select) falló: ${error.message} [${error.code}]`)
    const rows = (data ?? []) as (Row & { id: number })[]
    for (const r of rows) candidatas.set(r.id, r)
    if (rows.length < PAGE) break
    if (from > 50000) break // tope de seguridad
  }
  if (!candidatas.size) return { entries: [], claimIds: [] }

  // 2) Reclamo. Solo vuelven las filas que seguían sin copiar al momento del UPDATE.
  const now = new Date().toISOString()
  const ids = [...candidatas.keys()]
  const claimIds: number[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    const tanda = ids.slice(i, i + BATCH)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(TABLE) as any)
      .update({ copied_at: now })
      .in('id', tanda)
      .is('copied_at', null)
      .select('id')
    if (error) throw new Error(`claimRegistroUncopied(update) falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) claimIds.push(r.id as number)
  }

  // Se devuelven en el mismo orden en que se pegan: por fecha de pago ascendente.
  const entries = claimIds.map(id => rowToEntry(candidatas.get(id) as Row))
  return { entries, claimIds }
}

// Devuelve a "sin copiar" las entradas reclamadas. Se usa cuando el navegador no pudo
// escribir el portapapeles: sin esto quedarían marcadas como copiadas sin que nadie
// las haya pegado nunca en la planilla.
export async function unclaimRegistro(ids: number[]): Promise<void> {
  if (!ids.length) return
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(TABLE) as any).update({ copied_at: null }).in('id', ids)
  if (error) throw new Error(`unclaimRegistro falló: ${error.message} [${error.code}]`)
}

// Trae TODAS las entradas sin copiar que cumplen los filtros (solo lectura, para
// contar o previsualizar). Copiar NO usa esto: usa claimRegistroUncopied.
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

// PAGINADO OBLIGATORIO: PostgREST corta en 1000 filas y devuelve las primeras del
// heap (las más viejas), sin avisar. Sin paginar, todo match posterior a la fila
// 1000 quedaba fuera del set y su pago volvía a la cola en el siguiente ciclo del
// cron, contándose dos veces. El `.order('id')` no es cosmético: sin un orden
// estable, el paginado por `range` puede saltear o repetir filas.
export async function getConfirmedMarks(sinceMs?: number): Promise<ConfirmedMark[]> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs ?? Date.now() - CONFIRMED_WINDOW_MS).toISOString()
  const out: ConfirmedMark[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(TABLE) as any)
      .select('mp_payment_id, order_id, store_id, action')
      .in('action', ['manual_paid', 'auto_paid', 'dismissed'])
      .eq('hidden', false)
      .gte('ts', cutoff)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getConfirmedMarks falló: ${error.message} [${error.code}]`)
    for (const r of (data ?? []) as Row[]) {
      out.push({
        mpPaymentId: r.mp_payment_id ?? undefined,
        orderId: r.order_id ?? undefined,
        storeId: r.store_id ?? undefined,
        action: r.action,
      })
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
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
// Paginado: alimenta la detección de duplicados de /api/buscar-orden. Si truncara,
// una orden ya pagada podría no encontrarse y reclamarse de nuevo.
export async function findRegistroByStoreSince(storeId: string, sinceMs: number): Promise<LogEntry[]> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs).toISOString()
  const out: LogEntry[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(TABLE) as any)
      .select('*')
      .eq('store_id', storeId)
      .eq('hidden', false)
      .in('action', ['manual_paid', 'auto_paid'])
      .gte('ts', cutoff)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`findRegistroByStoreSince falló: ${error.message} [${error.code}]`)
    out.push(...(data ?? []).map(rowToEntry))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
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
    .neq('source', 'saldo_personalizado')   // el saldo personalizado va en movimientos, no en la tabla de órdenes
    .gte('ts', desde)
    .lt('ts', hasta)
    .order('ts', { ascending: false })
  if (error) throw new Error(`queryRegistroByStoreDay falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({ registroId: r.id as number, entry: rowToEntry(r) }))
}

// Saldos personalizados (ingresos manuales del admin) acreditados en un día. Mismo
// rango y corte que queryRegistroByStoreDay, pero solo los source='saldo_personalizado'
// (que aquélla excluye). Se muestran en su propia tabla —con formato de orden— en el portal.
export async function querySaldosPersonalizadosByStoreDay(
  storeId: string, diaART: string,
): Promise<Array<{ registroId: number; entry: LogEntry }>> {
  const supabase = getClient()
  const diaDesde = new Date(`${diaART}T00:00:00-03:00`).getTime()
  const hasta = new Date(diaDesde + 24 * 60 * 60 * 1000).toISOString()
  const desde = new Date(Math.max(diaDesde, BALANCE_CUTOFF.getTime())).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('*')
    .eq('store_id', storeId)
    .eq('hidden', false)
    .eq('source', 'saldo_personalizado')
    .gte('ts', desde)
    .lt('ts', hasta)
    .order('ts', { ascending: false })
  if (error) throw new Error(`querySaldosPersonalizadosByStoreDay falló: ${error.message} [${error.code}]`)
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
    .neq('source', 'saldo_personalizado')   // el saldo personalizado no es una orden
    .gte('ts', desde)
    .or(ors.join(','))
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`searchRegistroByStore falló: ${error.message} [${error.code}]`)
  return (data ?? []).map((r: Row) => ({ registroId: r.id as number, entry: rowToEntry(r) }))
}

// Reclamos de pagos hechos por tiendas (source='tienda_buscar') en una ventana.
// Alimenta el feed informativo de Administración General (solo lectura).
async function getReclamosOkIds(): Promise<Set<number>> {
  const v = await kvGet<{ ids: number[] }>(RECLAMOS_OK_KEY)
  return new Set(v?.ids ?? [])
}

// Marca un reclamo como OK: lo saca del feed del admin. Read-merge-write con tope
// (los ids son monótonos, así que conservar los más altos = los más recientes).
// Idempotente y sin efecto sobre el pago/registro/balance.
export async function marcarReclamoOk(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('id de reclamo inválido')
  const actuales = await getReclamosOkIds()
  actuales.add(id)
  const ids = Array.from(actuales).sort((a, b) => b - a).slice(0, 2000)
  await kvSet(RECLAMOS_OK_KEY, { ids })
}

export interface ReclamoReciente {
  id: number
  timestamp: string        // cuándo la tienda se adjudicó el pago
  storeId: string
  storeName: string
  amount: number
  orderNumber: string
  customerName: string     // cliente de la orden emparejada
  nombrePagador: string    // quién pagó
  cuit: string
  email: string
  fechaPago: string        // cuándo entró el pago a la billetera
  billetera: string        // billetera de origen del dinero (label)
  metodoPago: string
  referencia: string
  mpPaymentId: string
}

export async function getReclamosRecientes(sinceMs: number): Promise<ReclamoReciente[]> {
  const supabase = getClient()
  const cutoff = new Date(sinceMs).toISOString()
  const [res, okIds] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from(TABLE) as any)
      .select('id, ts, store_id, store_name, amount, order_number, customer_name, mp_payment_id, payment')
      .eq('source', 'tienda_buscar')
      .eq('hidden', false)
      .gte('ts', cutoff)
      .order('ts', { ascending: false }),
    getReclamosOkIds(),
  ])
  const { data, error } = res
  if (error) throw new Error(`getReclamosRecientes falló: ${error.message} [${error.code}]`)
  return (data ?? [])
    .filter((r: Row) => !okIds.has(Number(r.id)))
    .map((r: Row): ReclamoReciente => {
      const p = r.payment ?? {}
      return {
        id: Number(r.id),
        timestamp: r.ts,
        storeId: r.store_id ?? '',
        storeName: r.store_name ?? '',
        amount: Number(p.monto ?? r.amount) || 0,
        orderNumber: r.order_number ?? '',
        customerName: r.customer_name ?? '',
        nombrePagador: p.nombrePagador ?? '',
        cuit: p.cuitPagador ?? '',
        email: p.emailPagador ?? '',
        fechaPago: p.fechaPago ?? '',
        billetera: billeteraLabel(p.source ?? ''),
        metodoPago: p.metodoPago ?? '',
        referencia: p.referencia ?? '',
        mpPaymentId: p.mpPaymentId ?? r.mp_payment_id ?? '',
      }
    })
}

// ─────────────────────────────────────────────
// Edición / marcado (para /api/log PATCH)
// ─────────────────────────────────────────────

// Alias histórico: el registro general lo llamaba RegistroEdit. Es el mismo
// conjunto de campos que edita Administración Financiera.
export type RegistroEdit = RegistroCampos

// Edita la entrada identificada por su timestamp (así la referencia el registro
// general). Resuelve el ts a ids y delega en updateRegistroPorId, para que ambas
// pantallas escriban por el mismo camino y no se desincronicen.
export async function updateRegistroByTimestamp(timestamp: string, edit: RegistroEdit): Promise<boolean> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: selErr } = await (supabase.from(TABLE) as any)
    .select('id')
    .eq('ts', timestamp)
  if (selErr) throw new Error(`updateRegistroByTimestamp(select) falló: ${selErr.message} [${selErr.code}]`)
  if (!rows || rows.length === 0) return false

  for (const row of rows as Row[]) await updateRegistroPorId(row.id, edit)
  return true
}

// ─────────────────────────────────────────────
// Edición de una entrada por id (panel del admin)
// ─────────────────────────────────────────────

// Un número de orden puede llevar un sufijo de pago parcial: "77349 (1)" es el
// segundo pago de la orden 77349. La base es el número sin ese sufijo.
export function baseOrden(orderNumber: string): string {
  return String(orderNumber ?? '').replace(/\s*\(\d+\)\s*$/, '').trim()
}

export interface EntradaOrden {
  registroId: number
  orderNumber: string
  fecha: string
  monto: number
  cliente: string
}

// Otras entradas del registro de esa tienda que usan el mismo número de orden.
//   • exactas  → mismo string. Duplicar esto es un error: la edición se bloquea.
//   • similares → misma orden con otro sufijo ("77349" vs "77349 (1)"). Es legítimo
//     (pago parcial), así que solo se avisa.
//
// La tienda se identifica por store_id Y por store_name: las entradas emparejadas
// desde la pestaña Pagos (source='manual_pagos') quedan con store_id en NULL, y son
// justamente las que llevan el sufijo de pago parcial. Filtrar solo por store_id
// dejaría pasar el duplicado en el caso que más importa.
export async function buscarEntradasPorOrden(
  storeId: string, storeName: string, orderNumber: string, excluirRegistroId?: number,
): Promise<{ exactas: EntradaOrden[]; similares: EntradaOrden[] }> {
  const supabase = getClient()
  const base = baseOrden(orderNumber)
  if (!base) return { exactas: [], similares: [] }

  // Se acota por el número (pocas filas) y la tienda se resuelve acá abajo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('id, order_number, store_id, store_name, ts, amount, customer_name, payment')
    .eq('hidden', false)
    .in('action', MATCHED_ACTIONS)
    .like('order_number', `${base}%`)
  if (error) throw new Error(`buscarEntradasPorOrden falló: ${error.message} [${error.code}]`)

  const exactas: EntradaOrden[] = []
  const similares: EntradaOrden[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    if (excluirRegistroId != null && r.id === excluirRegistroId) continue
    const esDeLaTienda = r.store_id ? r.store_id === storeId : r.store_name === storeName
    if (!esDeLaTienda) continue
    const num = String(r.order_number ?? '')
    // El LIKE trae falsos positivos ("7734" matchea "77349"): filtrar por base exacta.
    if (baseOrden(num) !== base) continue
    const e: EntradaOrden = {
      registroId: r.id,
      orderNumber: num,
      fecha: r.payment?.fechaPago || r.ts,
      monto: Number(r.payment?.monto ?? r.amount) || 0,
      cliente: r.payment?.nombrePagador || r.customer_name || '',
    }
    if (num === String(orderNumber)) exactas.push(e)
    else similares.push(e)
  }
  return { exactas, similares }
}

export interface RegistroCampos {
  orderNumber?: string
  orderId?: string | null   // reasociar el pago a otra orden de la tienda
  customerName?: string
  cuit?: string
  storeName?: string
  hidden?: boolean
  hechoPor?: string         // email del admin que editó (trazabilidad)
}

// Datos mínimos de una entrada (para reasociar: saber la orden vieja y el pago).
export async function getRegistroBasico(registroId: number): Promise<
  { orderId: string | null; orderNumber: string | null; mpPaymentId: string | null; storeId: string | null; storeName: string | null } | null
> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(TABLE) as any)
    .select('order_id, order_number, mp_payment_id, store_id, store_name').eq('id', registroId).maybeSingle()
  if (error) throw new Error(`getRegistroBasico falló: ${error.message} [${error.code}]`)
  if (!data) return null
  return {
    orderId: data.order_id ?? null, orderNumber: data.order_number ?? null,
    mpPaymentId: data.mp_payment_id ?? null, storeId: data.store_id ?? null, storeName: data.store_name ?? null,
  }
}

// ÚNICO camino de edición del registro. Lo usan las dos pantallas —el registro
// general y la tabla de Administración Financiera— para que una corrección hecha
// en cualquiera de las dos se vea en la otra. registro_log es la fuente de verdad.
//
// No toca monto ni fecha: eso movería el saldo por la puerta de atrás.
//
// Los mismos datos viven duplicados en tres lugares por diseño de la tabla
// (columnas top-level, el JSONB `payment` y el JSONB `order_data`) y hay que
// escribirlos en los tres: la UI lee de uno u otro según la pantalla.
export async function updateRegistroPorId(registroId: number, campos: RegistroCampos): Promise<boolean> {
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: selErr } = await (supabase.from(TABLE) as any)
    .select('*').eq('id', registroId).maybeSingle()
  if (selErr) throw new Error(`updateRegistroPorId(select) falló: ${selErr.message} [${selErr.code}]`)
  if (!row) return false

  const patch: Row = {}
  const payment = row.payment ? { ...row.payment } : null
  const orderData = row.order_data ? { ...row.order_data } : null

  if (campos.customerName !== undefined) {
    patch.customer_name = campos.customerName
    // La tabla del portal muestra payment.nombrePagador primero: se actualizan los dos.
    if (payment) payment.nombrePagador = campos.customerName
    if (orderData) orderData.customerName = campos.customerName
  }
  if (campos.cuit !== undefined) {
    patch.cuit_pagador = campos.cuit
    if (payment) payment.cuitPagador = campos.cuit
  }
  if (campos.orderNumber !== undefined) {
    patch.order_number = campos.orderNumber
    if (orderData) orderData.orderNumber = campos.orderNumber
  }
  if (campos.orderId !== undefined) {
    patch.order_id = campos.orderId
    if (orderData) orderData.orderId = campos.orderId ?? undefined
  }
  if (campos.storeName !== undefined) {
    patch.store_name = campos.storeName
    if (orderData) orderData.storeName = campos.storeName
  }
  if (campos.hidden !== undefined) patch.hidden = campos.hidden
  if (campos.hechoPor !== undefined) patch.hecho_por = campos.hechoPor
  if (payment) patch.payment = payment
  if (orderData) patch.order_data = orderData

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(TABLE) as any).update(patch).eq('id', registroId)
  if (error) throw new Error(`updateRegistroPorId(update) falló: ${error.message} [${error.code}]`)

  // El movimiento de balance guarda "Orden #123 · Tienda" congelado al crearse. Si
  // cambió alguno de los dos, hay que reescribirlo o el extracto muestra el viejo.
  if (campos.orderNumber !== undefined || campos.storeName !== undefined) {
    const orden = campos.orderNumber ?? row.order_number
    const tienda = campos.storeName ?? row.store_name
    await actualizarDescripcionIngreso(registroId, `Orden #${orden || '—'} · ${tienda || ''}`.trim())
  }
  return true
}

// OBSOLETO. Marca por `ts`, que no es único, y no reclama nada: dos admins copiando a
// la vez se llevaban las mismas entradas. Lo reemplaza claimRegistroUncopied.
// Solo sigue acá para no romper una pestaña vieja abierta durante el deploy; la UI
// actual no lo llama. Borrar cuando no queden clientes viejos.
export async function markRegistroCopied(timestamps: string[]): Promise<void> {
  if (!timestamps.length) return
  const supabase = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(TABLE) as any)
    .update({ copied_at: new Date().toISOString() })
    .in('ts', timestamps)
  if (error) throw new Error(`markRegistroCopied falló: ${error.message} [${error.code}]`)
}
