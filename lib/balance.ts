import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getUsdtRate } from './cotizacion'
import { toUTCISO, fechaEgresoSaldo } from './utils'
import { BALANCE_CUTOFF } from './config'
import { getComisiones, comisionTienda, comisionTiendaSobre } from './comisiones'
import { getRefundsByMovementIds } from './reembolsos'
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
    fecha: fechaEgresoSaldo(),   // día anterior: el egreso se descuenta del saldo diario de ayer
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
  fecha?: string,   // día anterior (fechaEgresoSaldo); se pasa igual que el created_at del refund para que tienda y billetera queden en el mismo día
): Promise<number> {
  const { data, error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'reembolso',
    fecha: fecha ?? fechaEgresoSaldo(),
    ars: -Math.abs(arsMonto),
    usdt: -Math.abs(usdtMonto),
    usdt_rate: cotizacion,
    rate_source: 'manual',
    descripcion,
  }).select('id').single()
  if (error) throw new Error(`registrarReembolso falló: ${error.message} [${error.code}]`)
  return data.id as number
}

// Ingreso con cotización MANUAL (saldo personalizado del admin). tipo='ingreso_manual'
// → cuenta en el saldo y en la base de comisión igual que una orden, pero se muestra en
// la sección de MOVIMIENTOS del extracto (no en la tabla de órdenes). ars/usdt positivos,
// la tasa la pone el admin → rate_source 'manual' (no entra al backfill). La fecha es la
// del pago ingresada por el admin (default: ahora).
export async function registrarIngresoManual(
  storeId: string, registroId: number | null, ars: number, usdt: number, tasa: number, descripcion: string,
  fecha?: string,
): Promise<void> {
  const { error } = await getClient().from(TABLE).insert({
    store_id: storeId,
    tipo: 'ingreso_manual',
    fecha: fecha ?? new Date().toISOString(),
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
    const comisionArs = comisionTiendaSobre(Number(r.ingreso_ars) || 0, pct)
    const comisionUsdt = comisionTiendaSobre(Number(r.ingreso_usdt) || 0, pct)
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

// La descripción del movimiento ("Orden #123 · Tienda") se arma al crearlo. Si el
// admin corrige el número de orden o el nombre de la tienda, hay que reescribirla:
// si no, el extracto del balance sigue mostrando el número viejo.
export async function actualizarDescripcionIngreso(registroId: number, descripcion: string): Promise<void> {
  const { error } = await getClient()
    .from(TABLE)
    .update({ descripcion })
    .eq('ref_registro_id', registroId)
    .eq('tipo', 'ingreso_orden')
  if (error) throw new Error(`actualizarDescripcionIngreso falló: ${error.message} [${error.code}]`)
}

// Cambia la cotización de un ingreso ya registrado y recalcula su USDT. Es la
// única forma de que el saldo de la tienda cambie por una edición: el ARS no se
// toca, solo cuántos USDT valían esos pesos.
//
// rate_source pasa a 'manual': la puso el admin a mano, así que el backfill de
// cotizaciones no debe volver a pisarla.
//
// Devuelve el movimiento actualizado, o null si esa entrada no tiene movimiento de
// balance (p. ej. una orden anterior a BALANCE_CUTOFF, que nunca generó ingreso).
export async function actualizarCotizacionDeIngreso(
  registroId: number, cotizacion: number,
): Promise<BalanceMovement | null> {
  if (!Number.isFinite(cotizacion) || cotizacion <= 0) throw new Error('Cotización inválida')

  const { data: mov, error: selErr } = await getClient()
    .from(TABLE)
    .select('*')
    .eq('ref_registro_id', registroId)
    .eq('tipo', 'ingreso_orden')
    .maybeSingle()
  if (selErr) throw new Error(`actualizarCotizacionDeIngreso(select) falló: ${selErr.message} [${selErr.code}]`)
  if (!mov) return null

  const ars = Number(mov.ars) || 0
  const { data, error } = await getClient()
    .from(TABLE)
    .update({ usdt: ars / cotizacion, usdt_rate: cotizacion, rate_source: 'manual' })
    .eq('id', mov.id)
    .select('*')
    .single()
  if (error) throw new Error(`actualizarCotizacionDeIngreso(update) falló: ${error.message} [${error.code}]`)
  return rowToMovement(data)
}

// Días (ART) en los que la tienda tuvo algún movimiento: una orden acreditada, una
// transferencia pagada, un reembolso o un ajuste. El calendario deshabilita el resto.
// Paginado: la tabla crece sin cota y truncarla escondería días en silencio.
export async function getDiasConMovimiento(storeId: string): Promise<string[]> {
  const dias = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await getClient()
      .from(TABLE)
      .select('fecha')
      .eq('store_id', storeId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getDiasConMovimiento falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) {
      const t = new Date(r.fecha as string).getTime()
      // Argentina es UTC-3 fijo: restar 3h y quedarse con la fecha.
      if (Number.isFinite(t)) dias.add(new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10))
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return [...dias].sort()
}

// Balance de UN día: la misma cuenta que getBalances (bruto − comisión sobre los
// ingresos), pero acotada a los movimientos de ese día. Suma de los saldos diarios
// = saldo total, porque cada movimiento cae en un único día.
//
// En balance_movements los egresos y reembolsos ya vienen en NEGATIVO, así que el
// bruto es la suma directa; acá se devuelven en positivo, para mostrarlos como "sale".
// Un movimiento del día enriquecido con lo que hace falta para mostrarlo:
//   • montoOriginal / monedaOriginal → lo que ESCRIBIÓ el admin al pagar (en su
//     moneda). El balance_movements guarda solo el USDT descontado; el monto en la
//     moneda pedida (p. ej. los ARS de una transferencia) vive en transfer_requests.
//   • tieneComprobante → si esa transferencia tiene un comprobante para descargar.
export interface MovimientoDetalle extends BalanceMovement {
  montoOriginal: number | null
  monedaOriginal: string | null
  // Solo saldo personalizado (ingreso_manual): datos del registro ligado, para mostrarlos
  // y editarlos (nombre del pagador, CUIT y N° de orden/motivo).
  nombrePagador?: string | null
  cuitPagador?: string | null
  orderNumber?: string | null
  tieneComprobante: boolean
  refundId: number | null   // si es un reembolso con comprobante, su id (para descargarlo)
}

export interface BalanceDia {
  ingresosArs: number
  ingresosUsdt: number
  cantidadIngresos: number
  ingresoManualUsdt: number    // saldo personalizado del día (positivo); figura como su propia línea del desglose
  comisionArs: number
  comisionUsdt: number
  comisionPct: number
  transferenciasUsdt: number   // positivo
  reembolsosArs: number        // positivo
  reembolsosUsdt: number       // positivo
  ajustesUsdt: number          // signado
  saldoUsdt: number            // neto del día
  movimientos: MovimientoDetalle[]  // egresos, reembolsos y ajustes (los ingresos ya van en la tabla de órdenes)
}

// Detalle de las transferencias (por ref_transfer_id): el monto/moneda que ingresó
// el admin y si hay comprobante. Lo usa el extracto del día para completar la
// columna en ARS y el ícono de descarga.
async function getDetalleTransferencias(
  ids: number[],
): Promise<Map<number, { monto: number | null; moneda: string | null; comprobante: boolean }>> {
  const map = new Map<number, { monto: number | null; moneda: string | null; comprobante: boolean }>()
  if (!ids.length) return map
  const { data, error } = await getClient()
    .from('transfer_requests')
    .select('id, descuento, comprobante_path')
    .in('id', ids)
  if (error) throw new Error(`getDetalleTransferencias falló: ${error.message} [${error.code}]`)
  for (const r of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (r as any).descuento ?? {}
    map.set(r.id as number, {
      monto: Number.isFinite(Number(d.monto)) ? Number(d.monto) : null,
      moneda: d.moneda ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      comprobante: !!(r as any).comprobante_path,
    })
  }
  return map
}

export async function getBalanceDia(storeId: string, diaART: string): Promise<BalanceDia> {
  const [movs, cfg] = await Promise.all([getMovimientosDia(storeId, diaART), getComisiones()])
  const pct = comisionTienda(cfg, storeId)

  const suma = (fn: (m: BalanceMovement) => number, filtro: (m: BalanceMovement) => boolean) =>
    movs.filter(filtro).reduce((s, m) => s + fn(m), 0)

  // "Ingresos por órdenes" = solo ingreso_orden (lo que se ve en la tabla de órdenes).
  // El saldo personalizado (ingreso_manual) NO va en esa línea: figura en movimientos.
  const esIngreso = (m: BalanceMovement) => m.tipo === 'ingreso_orden'
  // Gravado por la comisión de tienda: órdenes + saldo personalizado.
  const esGravado = (m: BalanceMovement) => m.tipo === 'ingreso_orden' || m.tipo === 'ingreso_manual'
  const ingresosArs = suma(m => m.ars, esIngreso)
  const ingresosUsdt = suma(m => m.usdt ?? 0, esIngreso)
  const ingresoManualUsdt = suma(m => m.usdt ?? 0, m => m.tipo === 'ingreso_manual')
  const comisionArs = comisionTiendaSobre(suma(m => m.ars, esGravado), pct)
  const comisionUsdt = comisionTiendaSobre(suma(m => m.usdt ?? 0, esGravado), pct)

  const transferenciasUsdt = Math.abs(suma(m => m.usdt ?? 0, m => m.tipo === 'egreso_transferencia'))
  const reembolsosArs = Math.abs(suma(m => m.ars, m => m.tipo === 'reembolso'))
  const reembolsosUsdt = Math.abs(suma(m => m.usdt ?? 0, m => m.tipo === 'reembolso'))
  const ajustesUsdt = suma(m => m.usdt ?? 0, m => m.tipo === 'ajuste')

  const brutoUsdt = movs.reduce((s, m) => s + (m.usdt ?? 0), 0)

  // Egresos, reembolsos y ajustes. Se enriquecen con el detalle de la transferencia
  // (monto que ingresó el admin + comprobante) para la tabla del día.
  // Solo egresos/reembolsos/ajustes. El saldo personalizado (ingreso_manual) NO va acá:
  // tiene su propia tabla con formato de orden (/api/tienda/registro → saldosPersonalizados).
  const noIngresos = movs.filter(m =>
    m.tipo === 'egreso_transferencia' || m.tipo === 'reembolso' || m.tipo === 'ajuste')
  const transferIds = noIngresos
    .filter(m => m.tipo === 'egreso_transferencia' && m.refTransferId != null)
    .map(m => m.refTransferId as number)
  // Los reembolsos guardan su comprobante en la tabla refunds (no en transfer_requests):
  // se cruzan por ref_movement_id = id del movimiento de balance.
  const reembolsoIds = noIngresos.filter(m => m.tipo === 'reembolso').map(m => m.id)
  const [detalles, refundsPorMov] = await Promise.all([
    getDetalleTransferencias(transferIds),
    getRefundsByMovementIds(reembolsoIds),
  ])

  const movimientos: MovimientoDetalle[] = noIngresos.map(m => {
    const d = m.refTransferId != null ? detalles.get(m.refTransferId) : undefined
    const refund = m.tipo === 'reembolso' ? refundsPorMov.get(m.id) : undefined
    const refundConComp = refund?.comprobantePath ? refund : undefined
    return {
      ...m,
      montoOriginal: d?.monto ?? null,
      monedaOriginal: d?.moneda ?? null,
      nombrePagador: null,
      cuitPagador: null,
      orderNumber: null,
      tieneComprobante: !!d?.comprobante || !!refundConComp,
      refundId: refundConComp ? refundConComp.id : null,
    }
  })

  return {
    ingresosArs, ingresosUsdt, cantidadIngresos: movs.filter(esIngreso).length,
    ingresoManualUsdt,
    comisionArs, comisionUsdt, comisionPct: pct,
    transferenciasUsdt, reembolsosArs, reembolsosUsdt, ajustesUsdt,
    saldoUsdt: brutoUsdt - comisionUsdt,
    movimientos,
  }
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
