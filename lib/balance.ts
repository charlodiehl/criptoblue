import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getUsdtRate } from './cotizacion'
import { toUTCISO } from './utils'
import { BALANCE_CUTOFF } from './config'
import { getComisiones, comisionTienda } from './comisiones'
import type { LogEntry, StoreBalance, DescuentoMoneda, TransferDescuento, BalanceMovement } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Motor de balance por tienda (tabla balance_movements).
//
// Libro mayor SIGNADO en dos monedas paralelas:
//   ars  → siempre presente (ingresos +, egresos −)
//   usdt → puede ser NULL = "cotización pendiente" (la API aún no estaba
//          conectada al crear el movimiento); backfill-cotizaciones.mjs los completa.
// Balance = SUM(ars) / SUM(usdt) — vía RPC balances_tiendas() (una sola query).
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'balance_movements'

let _client: SupabaseClient | null = null
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _client
}

// ─── Ingresos (hook desde lib/registro.ts) ───────────────────────────────────

// Crea el movimiento de ingreso por una orden emparejada/registrada.
// La cotización se toma DEL MOMENTO DEL EMPAREJAMIENTO (decisión del usuario):
// getUsdtRate() devuelve la cotización actual (Binance P2P +0,5%). Si la API está
// caída, queda 'pendiente' y la completa el backfill de /api/cron/cotizaciones.
export async function registrarIngresoOrden(registroId: number | null, entry: LogEntry): Promise<void> {
  if (!entry.storeId) return
  // Corte del balance: las órdenes anteriores a BALANCE_CUTOFF no generan ingreso
  // (se representan con el saldo inicial). Las nuevas siempre tienen fecha actual.
  if (new Date(entry.timestamp).getTime() < BALANCE_CUTOFF.getTime()) return
  const ars = entry.amount ?? 0
  if (!Number.isFinite(ars) || ars <= 0) return

  const rate = await getUsdtRate()
  const { error } = await getClient().from(TABLE).insert({
    store_id: entry.storeId,
    tipo: 'ingreso_orden',
    fecha: toUTCISO(entry.timestamp),
    ars,
    usdt: rate ? ars / rate : null,
    usdt_rate: rate,
    rate_source: rate ? 'api' : 'pendiente',
    ref_registro_id: registroId,
    descripcion: `Orden #${entry.orderNumber || '—'} · ${entry.storeName || ''}`.trim(),
  })
  if (error) throw new Error(`registrarIngresoOrden falló: ${error.message} [${error.code}]`)
}

// ─── Egresos (pago de solicitudes de transferencia) ──────────────────────────

// ÚNICA fuente del cálculo de descuento. El saldo de la tienda vive SOLO en USDT:
// todo retiro se traduce a USDT y solo se piden las tasas necesarias para eso.
//   ARS / ARS_BILLETE  → cotizacionUsdtArs  (usdt = monto / cotización)
//   USDT               → sin tasa           (usdt = monto)
//   USD / USD_BILLETE   → tasaUsdUsdt        (usdt = monto × tasaUsdUsdt)
// arsDescontado queda en 0: la tienda ya no tiene saldo en ARS.
export function calcularDescuento(
  moneda: DescuentoMoneda,
  monto: number,
  tasas: { cotizacionUsdtArs?: number; tasaUsdtArs?: number; tasaUsdArs?: number; tasaUsdUsdt?: number },
): TransferDescuento {
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('Monto inválido')
  const pos = (v: number | undefined, nombre: string): number => {
    if (!Number.isFinite(v) || (v as number) <= 0) throw new Error(`Falta la tasa obligatoria: ${nombre}`)
    return v as number
  }

  switch (moneda) {
    case 'ARS':
    case 'ARS_BILLETE': {
      const cotizacion = pos(tasas.cotizacionUsdtArs, 'cotización USDT/ARS')
      return { moneda, monto, cotizacionUsdtArs: cotizacion, arsDescontado: 0, usdtDescontado: monto / cotizacion }
    }
    case 'USDT':
      return { moneda, monto, arsDescontado: 0, usdtDescontado: monto }
    case 'USD':
    case 'USD_BILLETE': {
      const tasaUsdt = pos(tasas.tasaUsdUsdt, 'tasa USD/USDT')
      return { moneda, monto, tasaUsdUsdt: tasaUsdt, arsDescontado: 0, usdtDescontado: monto * tasaUsdt }
    }
    default:
      throw new Error(`Moneda de descuento desconocida: ${moneda}`)
  }
}

// Crea el movimiento de egreso al pagar una solicitud (montos en NEGATIVO).
// La tasa la puso el admin a mano → rate_source 'manual' (no entra al backfill).
export async function registrarEgresoTransferencia(
  transferId: number,
  storeId: string,
  descuento: TransferDescuento,
  descripcion: string,
): Promise<void> {
  const { error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'egreso_transferencia',
    fecha: new Date().toISOString(),
    ars: -descuento.arsDescontado,   // 0: la tienda ya no lleva saldo en ARS
    usdt: -descuento.usdtDescontado,
    usdt_rate: descuento.cotizacionUsdtArs ?? null,   // solo aplica a retiros en ARS
    rate_source: 'manual',
    ref_transfer_id: transferId,
    descripcion,
  })
  if (error) throw new Error(`registrarEgresoTransferencia falló: ${error.message} [${error.code}]`)
}

// Completa la cotización USDT de TODOS los movimientos que quedaron 'pendiente'
// con la cotización ACTUAL (la misma para todas las tiendas). Lo llama el cron
// cada 10 min y scripts/backfill-cotizaciones.mjs. Idempotente: solo toca los que
// siguen 'pendiente'. usdt = ars / rate (ars ya viene SIGNADO → el signo se conserva).
export async function backfillCotizacionesPendientes(): Promise<{ actualizados: number; rate: number | null }> {
  const rate = await getUsdtRate()
  if (!rate) return { actualizados: 0, rate: null }

  const c = getClient()
  const { data: pendientes, error } = await c.from(TABLE).select('id, ars').eq('rate_source', 'pendiente')
  if (error) throw new Error(`backfillCotizaciones falló: ${error.message} [${error.code}]`)

  let actualizados = 0
  for (const m of pendientes ?? []) {
    const { error: uErr } = await c.from(TABLE)
      .update({ usdt: Number(m.ars) / rate, usdt_rate: rate, rate_source: 'api' })
      .eq('id', m.id)
      .eq('rate_source', 'pendiente') // no pisar si otro proceso ya lo completó
    if (!uErr) actualizados++
  }
  return { actualizados, rate }
}

// Reembolso de una orden: RESTA del saldo (ars y usdt en NEGATIVO) el día que se
// reembolsa. Cotización manual (la pone el admin) → rate_source 'manual', no entra
// al backfill. tipo 'reembolso' → NO cuenta como ingreso (no afecta la base de
// comisión), solo baja el saldo. Devuelve el id del movimiento creado.
export async function registrarReembolso(
  storeId: string, arsMonto: number, usdtMonto: number, cotizacion: number, descripcion: string,
): Promise<number> {
  const { data, error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'reembolso',
    fecha: new Date().toISOString(),
    ars: -Math.abs(arsMonto),
    usdt: -Math.abs(usdtMonto),
    usdt_rate: cotizacion,
    rate_source: 'manual',
    descripcion,
  }).select('id').single()
  if (error) throw new Error(`registrarReembolso falló: ${error.message} [${error.code}]`)
  return data.id as number
}

// Ingreso con cotización MANUAL (saldo personalizado del admin). tipo='ingreso_orden'
// → cuenta en la base de comisión, igual que una orden. ars/usdt positivos, la tasa
// la pone el admin → rate_source 'manual' (no entra al backfill).
export async function registrarIngresoManual(
  storeId: string, registroId: number | null, ars: number, usdt: number, tasa: number, descripcion: string,
): Promise<void> {
  const { error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'ingreso_orden',
    fecha: new Date().toISOString(),
    ars,
    usdt,
    usdt_rate: tasa,
    rate_source: 'manual',
    ref_registro_id: registroId,
    descripcion,
  })
  if (error) throw new Error(`registrarIngresoManual falló: ${error.message} [${error.code}]`)
}

// Ajuste manual (saldos iniciales, correcciones). ars/usdt SIGNADOS.
export async function registrarAjuste(storeId: string, ars: number, usdt: number, descripcion: string): Promise<void> {
  const { error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'ajuste',
    fecha: new Date().toISOString(),
    ars,
    usdt,
    usdt_rate: null,
    rate_source: 'manual',
    descripcion,
  })
  if (error) throw new Error(`registrarAjuste falló: ${error.message} [${error.code}]`)
}

// ─── Lecturas ────────────────────────────────────────────────────────────────

// Balance de TODAS las tiendas con movimientos (una sola llamada RPC).
// ars/usdt son NETOS: se descuenta la comisión (% de los ingresos por órdenes).
export async function getBalances(): Promise<StoreBalance[]> {
  const [rpc, cfg] = await Promise.all([getClient().rpc('balances_tiendas'), getComisiones()])
  const { data, error } = rpc
  if (error) throw new Error(`getBalances falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const grossArs = Number(r.ars) || 0
    const grossUsdt = Number(r.usdt) || 0
    const pct = comisionTienda(cfg, r.store_id)
    const comisionArs = (Number(r.ingreso_ars) || 0) * pct / 100
    const comisionUsdt = (Number(r.ingreso_usdt) || 0) * pct / 100
    return {
      storeId: r.store_id,
      ars: grossArs - comisionArs,     // NETO
      usdt: grossUsdt - comisionUsdt,  // NETO
      pendientes: Number(r.pendientes) || 0,
      comisionArs, comisionUsdt, comisionPct: pct,
    }
  })
}

// Balance de una tienda puntual. Sin movimientos → todo en 0 (pero con su % de comisión).
export async function getBalance(storeId: string): Promise<StoreBalance> {
  const balances = await getBalances()
  const found = balances.find(b => b.storeId === storeId)
  if (found) return found
  const cfg = await getComisiones()
  return { storeId, ars: 0, usdt: 0, pendientes: 0, comisionArs: 0, comisionUsdt: 0, comisionPct: comisionTienda(cfg, storeId) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMovement(r: any): BalanceMovement {
  return {
    id: r.id,
    storeId: r.store_id,
    tipo: r.tipo,
    fecha: r.fecha,
    ars: Number(r.ars),
    usdt: r.usdt === null ? null : Number(r.usdt),
    usdtRate: r.usdt_rate === null ? null : Number(r.usdt_rate),
    rateSource: r.rate_source,
    refRegistroId: r.ref_registro_id,
    refTransferId: r.ref_transfer_id,
    descripcion: r.descripcion,
  }
}

// Movimientos de una tienda en un día ART ('YYYY-MM-DD'). Argentina es UTC-3 fijo.
export async function getMovimientosDia(storeId: string, diaART: string): Promise<BalanceMovement[]> {
  const desde = new Date(`${diaART}T00:00:00-03:00`).toISOString()
  const hasta = new Date(new Date(desde).getTime() + 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await getClient()
    .from(TABLE)
    .select('*')
    .eq('store_id', storeId)
    .gte('fecha', desde)
    .lt('fecha', hasta)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`getMovimientosDia falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToMovement)
}

// Movimientos de ingreso vinculados a entradas del registro (para cruzar la
// cotización en la tabla del portal). Devuelve mapa ref_registro_id → movimiento.
export async function getMovimientosPorRegistroIds(registroIds: number[]): Promise<Map<number, BalanceMovement>> {
  const map = new Map<number, BalanceMovement>()
  if (!registroIds.length) return map
  const { data, error } = await getClient()
    .from(TABLE)
    .select('*')
    .in('ref_registro_id', registroIds)
  if (error) throw new Error(`getMovimientosPorRegistroIds falló: ${error.message} [${error.code}]`)
  for (const r of data ?? []) {
    const m = rowToMovement(r)
    if (m.refRegistroId != null) map.set(m.refRegistroId, m)
  }
  return map
}
