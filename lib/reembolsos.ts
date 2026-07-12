import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Refund, RefundRequest, RefundRequestEstado } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Capa de datos de reembolsos.
//   refunds          → reembolsos EJECUTADOS (ledger para el tope acumulado y la
//                      numeración "reembolso orden xxx (2)").
//   refund_requests  → solicitudes de reembolso hechas por las tiendas (llegan al
//                      panel del admin; el admin decide el monto final al ejecutar).
// El movimiento que baja el saldo lo crea registrarReembolso (lib/balance.ts).
// ─────────────────────────────────────────────────────────────────────────────

const REFUNDS = 'refunds'
const REQUESTS = 'refund_requests'
const BUCKET = 'comprobantes'

let _client: SupabaseClient | null = null
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRefund(r: any): Refund {
  return {
    id: r.id,
    storeId: r.store_id,
    orderNumber: r.order_number,
    orderId: r.order_id ?? null,
    orderTotal: r.order_total != null ? Number(r.order_total) : null,
    monto: Number(r.monto),
    usdt: r.usdt != null ? Number(r.usdt) : null,
    cotizacion: r.cotizacion != null ? Number(r.cotizacion) : null,
    wallet: r.wallet ?? null,
    seq: r.seq,
    comprobantePath: r.comprobante_path,
    requestId: r.request_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRequest(r: any): RefundRequest {
  return {
    id: r.id,
    storeId: r.store_id,
    orderNumber: r.order_number,
    orderId: r.order_id ?? null,
    orderTotal: r.order_total != null ? Number(r.order_total) : null,
    montoSolicitado: r.monto_solicitado != null ? Number(r.monto_solicitado) : null,
    estado: r.estado,
    createdBy: r.created_by,
    createdAt: r.created_at,
    processedAt: r.processed_at ?? null,
    processedBy: r.processed_by ?? null,
  }
}

// ─── Reembolsos ejecutados ────────────────────────────────────────────────────

// Todos los reembolsos ya hechos de una orden (para el tope acumulado + numeración).
export async function getRefundsPorOrden(storeId: string, orderNumber: string): Promise<Refund[]> {
  const { data, error } = await getClient()
    .from(REFUNDS)
    .select('*')
    .eq('store_id', storeId)
    .eq('order_number', String(orderNumber))
    .order('seq', { ascending: true })
  if (error) throw new Error(`getRefundsPorOrden falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToRefund)
}

export interface ResumenReembolsos {
  reembolsado: number   // suma ARS ya reembolsada
  count: number         // cantidad de reembolsos previos
  refunds: Refund[]
}

// Resumen de lo ya reembolsado de una orden.
export async function resumenReembolsos(storeId: string, orderNumber: string): Promise<ResumenReembolsos> {
  const refunds = await getRefundsPorOrden(storeId, orderNumber)
  const reembolsado = refunds.reduce((s, r) => s + r.monto, 0)
  return { reembolsado, count: refunds.length, refunds }
}

// Inserta un reembolso ejecutado. seq y ref_movement_id los calcula el orquestador
// (la route). Devuelve el registro creado.
export async function crearRefund(input: {
  storeId: string; orderNumber: string; orderId?: string | null; orderTotal?: number | null
  monto: number; usdt: number; cotizacion: number; wallet?: string | null; seq: number
  comprobantePath: string; requestId?: number | null; refMovementId?: number | null; createdBy: string
}): Promise<Refund> {
  const { data, error } = await getClient()
    .from(REFUNDS)
    .insert({
      store_id: input.storeId,
      order_number: String(input.orderNumber),
      order_id: input.orderId ?? null,
      order_total: input.orderTotal ?? null,
      monto: input.monto,
      usdt: input.usdt,
      cotizacion: input.cotizacion,
      wallet: input.wallet ?? null,
      seq: input.seq,
      comprobante_path: input.comprobantePath,
      request_id: input.requestId ?? null,
      ref_movement_id: input.refMovementId ?? null,
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`crearRefund falló: ${error.message} [${error.code}]`)
  return rowToRefund(data)
}

// Vincula el movimiento de balance al reembolso (best-effort, tras crearlo).
export async function setRefundMovement(refundId: number, movementId: number): Promise<void> {
  const { error } = await getClient().from(REFUNDS).update({ ref_movement_id: movementId }).eq('id', refundId)
  if (error) throw new Error(`setRefundMovement falló: ${error.message} [${error.code}]`)
}

// ─── Solicitudes de reembolso (tiendas) ───────────────────────────────────────

export async function crearRefundRequest(input: {
  storeId: string; orderNumber: string; orderId?: string | null; orderTotal?: number | null
  montoSolicitado?: number | null; createdBy: string
}): Promise<RefundRequest> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .insert({
      store_id: input.storeId,
      order_number: String(input.orderNumber),
      order_id: input.orderId ?? null,
      order_total: input.orderTotal ?? null,
      monto_solicitado: input.montoSolicitado ?? null,
      estado: 'pendiente',
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`crearRefundRequest falló: ${error.message} [${error.code}]`)
  return rowToRequest(data)
}

// Solicitudes para el admin (opcionalmente filtradas por estado).
export async function listarRefundRequests(estado?: RefundRequestEstado): Promise<RefundRequest[]> {
  let q = getClient().from(REQUESTS).select('*').order('created_at', { ascending: false })
  if (estado) q = q.eq('estado', estado)
  const { data, error } = await q
  if (error) throw new Error(`listarRefundRequests falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToRequest)
}

// Solicitudes propias de una tienda.
export async function listarRefundRequestsTienda(storeId: string): Promise<RefundRequest[]> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listarRefundRequestsTienda falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToRequest)
}

export async function getRefundRequestById(id: number): Promise<RefundRequest | null> {
  const { data, error } = await getClient().from(REQUESTS).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`getRefundRequestById falló: ${error.message} [${error.code}]`)
  return data ? rowToRequest(data) : null
}

// Marca una solicitud como procesada (CLAIM condicional: solo si sigue pendiente).
export async function marcarRefundRequestProcesada(id: number, processedBy: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .update({ estado: 'procesada', processed_at: new Date().toISOString(), processed_by: processedBy })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) throw new Error(`marcarRefundRequestProcesada falló: ${error.message} [${error.code}]`)
  return (data?.length ?? 0) > 0
}

// ─── Reembolsos por billetera (para restarlos del saldo de la billetera) ──────

// Total ARS reembolsado por billetera (la billetera devolvió ese dinero → su saldo baja).
// Paginado: es una suma de dinero sin cota temporal. Si truncara a 1000 filas
// restaría de menos y el saldo de la billetera quedaría inflado, en silencio.
export async function sumRefundsByWallet(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await getClient()
      .from(REFUNDS)
      .select('wallet, monto')
      .not('wallet', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`sumRefundsByWallet falló: ${error.message} [${error.code}]`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      const w = r.wallet as string
      out[w] = (out[w] ?? 0) + (Number(r.monto) || 0)
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Un reembolso por id (para descargar su comprobante, con chequeo de scope en la ruta).
export async function getRefundById(id: number): Promise<Refund | null> {
  const { data, error } = await getClient().from(REFUNDS).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`getRefundById falló: ${error.message} [${error.code}]`)
  return data ? rowToRefund(data) : null
}

// Reembolsos indexados por el id del movimiento de balance que crearon (ref_movement_id).
// Sirve para cruzar un movimiento 'reembolso' de una tienda con su fila de refunds
// (y así con su comprobante), sin depender de la descripción.
export async function getRefundsByMovementIds(movementIds: number[]): Promise<Map<number, Refund>> {
  const map = new Map<number, Refund>()
  if (!movementIds.length) return map
  const { data, error } = await getClient().from(REFUNDS).select('*').in('ref_movement_id', movementIds)
  if (error) throw new Error(`getRefundsByMovementIds falló: ${error.message} [${error.code}]`)
  for (const r of data ?? []) {
    const ref = rowToRefund(r)
    if (r.ref_movement_id != null) map.set(Number(r.ref_movement_id), ref)
  }
  return map
}

// Set de "storeId|orderNumber" de todas las órdenes con al menos un reembolso
// (total o parcial). Sirve para marcar visualmente un pago como "Reembolsado" en el
// extracto de la billetera — es solo estado visual, no afecta saldos. Paginado.
export async function getOrdenesReembolsadas(): Promise<Set<string>> {
  const out = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await getClient()
      .from(REFUNDS).select('store_id, order_number').order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`getOrdenesReembolsadas falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) out.add(`${r.store_id}|${String(r.order_number)}`)
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Reembolsos atribuidos a una billetera (para mostrar el detalle con su info).
export async function getRefundsDeWallet(wallet: string): Promise<Refund[]> {
  const { data, error } = await getClient()
    .from(REFUNDS)
    .select('*')
    .eq('wallet', wallet)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`getRefundsDeWallet falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToRefund)
}

// ─── Comprobante (bucket privado 'comprobantes') ──────────────────────────────

export async function subirComprobanteReembolso(
  filename: string, bytes: ArrayBuffer, contentType: string,
): Promise<string> {
  const safe = (filename || 'comprobante').replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `refund/${Date.now()}-${safe}`
  const { error } = await getClient().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error(`subirComprobanteReembolso falló: ${error.message}`)
  return path
}

export async function urlComprobanteReembolso(path: string, segundos = 3600): Promise<string | null> {
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, segundos)
  if (error) return null
  return data?.signedUrl ?? null
}
