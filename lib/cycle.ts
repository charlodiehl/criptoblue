import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders as getTNOrders } from './tiendanube'
import { getPendingOrders as getShopifyOrders } from './shopify'
import { loadState, saveState, getStores, appendError, loadLogs, saveLogs, withStateLock } from './storage'
import { getConfirmedMarks } from './registro'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS, SAMEMONTO_WINDOW_HOURS, ORDER_CACHE_MIN_HOURS, ORDER_CACHE_BUFFER_HOURS, PAYMENT_CACHE_HOURS, WALLETS_SIN_VENCIMIENTO } from './config'
import type { UnmatchedPayment, Store } from './types'
import { audit, auditApiCall } from './audit'
import { nowART, paymentWalletId } from './utils'
import { lookupNombreByCuit } from './cuit-lookup'

interface CycleResult {
  processed: number   // total pagos vistos en MP (puede incluir ya conocidos)
  newUnmatched: number // pagos verdaderamente nuevos agregados a la cola
  errors: string[]
  stores: Record<string, Store>
}

export async function processMPPayments(): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, newUnmatched: 0, errors: [], stores: {} }

  await audit({
    category: 'system', action: 'sync.start', result: 'success',
    actor: 'system', component: 'cycle',
    message: 'Inicio de ciclo de sincronización MP + órdenes',
  })

  const [state, stores] = await Promise.all([loadState(), getStores()])

  const now = new Date()
  const HOUR_MS = 60 * 60 * 1000

  // Cutoff de pagos: rolling 48h hacia atrás
  const paymentsRollingMs = now.getTime() - PAYMENT_CACHE_HOURS * HOUR_MS
  const sincePayments = new Date(Math.max(paymentsRollingMs, HARD_CUTOFF_PAYMENTS.getTime()))

  // Purge: igual que el rolling de pagos
  const purgeCutoff = new Date(Math.max(paymentsRollingMs, HARD_CUTOFF_PAYMENTS.getTime()))

  // Cutoff de ÓRDENES: anclado al pago sin emparejar más viejo VÁLIDO, para
  // garantizar que el cache cubra la ventana de detección de sameMontoCount
  // (24h) de los pagos vivos. Si no hay pagos en cola, usa el rolling mínimo.
  // Esto evita el bug donde una orden de borde quedaba fuera del cache cuando
  // el cron corría cerca de las 48h después del pago (caso #72784/#72787).
  //
  // CAP MÁXIMO: el cache nunca va más atrás de PAYMENT_CACHE + SAMEMONTO_WINDOW
  // + buffer (= 73h por defecto). Si hay pagos pegados de hace 20 días por un
  // bug de purge, no expandimos el cache hasta ahí — esos pagos ya no son
  // emparejables igualmente. Esto evita explosiones de tamaño del cache.
  const ordersRollingMs = now.getTime() - ORDER_CACHE_MIN_HOURS * HOUR_MS
  const maxCacheLookbackMs =
    now.getTime() -
    (PAYMENT_CACHE_HOURS + SAMEMONTO_WINDOW_HOURS + ORDER_CACHE_BUFFER_HOURS) * HOUR_MS

  // Solo considerar pagos dentro del rango de purga válido para el cálculo
  // del anchor del cache. Pagos más viejos que el rolling de pagos son "stuck"
  // y no deberían influir.
  const validUnmatchedTimes = state.unmatchedPayments
    .map(u => {
      const t = u.payment.fechaPago ? new Date(u.payment.fechaPago).getTime() : NaN
      return Number.isFinite(t) ? t : new Date(u.timestamp).getTime()
    })
    .filter(t => Number.isFinite(t) && t >= paymentsRollingMs)

  const oldestPaymentMs = validUnmatchedTimes.length > 0
    ? Math.min(...validUnmatchedTimes)
    : now.getTime()

  const oldestDetectionStartMs =
    oldestPaymentMs - SAMEMONTO_WINDOW_HOURS * HOUR_MS - ORDER_CACHE_BUFFER_HOURS * HOUR_MS

  // Aplicar el cap máximo
  const ordersCutoffMs = Math.max(
    Math.min(ordersRollingMs, oldestDetectionStartMs),
    maxCacheLookbackMs
  )
  const sinceOrders = new Date(Math.max(ordersCutoffMs, HARD_CUTOFF_ORDERS.getTime()))

  // Traer pagos aprobados desde el cutoff efectivo
  let payments
  const mpStart = Date.now()
  try {
    payments = await fetchAllPaymentsSince(sincePayments)
    await auditApiCall({
      action: 'mp.fetch_payments', component: 'cycle',
      endpoint: 'mercadopago/search', result: 'success',
      durationMs: Date.now() - mpStart,
      message: `Fetched ${payments.length} pagos desde ${sincePayments.toISOString()}`,
      meta: { count: payments.length, since: sincePayments.toISOString() },
    })
  } catch (err) {
    await auditApiCall({
      action: 'mp.fetch_payments', component: 'cycle',
      endpoint: 'mercadopago/search', result: 'failure',
      durationMs: Date.now() - mpStart,
      message: `Error al traer pagos de MP: ${String(err)}`,
      error: String(err),
    })
    result.errors.push(`MP fetch error: ${String(err)}`)
    // Solo guardar el error — no sobreescribir todo el estado para evitar pisar
    // cambios del usuario en registroLog (copiedAt, hidden, ediciones)
    const errorLogs = await loadLogs()
    appendError(errorLogs, 'mercadopago', 'error', `Error al traer pagos de MercadoPago: ${String(err)}`)
    await saveLogs(errorLogs)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  // IDs de pagos ya procesados (no deben reaparecer en la cola)
  // Incluye: confirmados via match y descartados.
  // Los externallyMarkedPayments ("no es de tiendas") se excluyen a propósito:
  // deben seguir en unmatchedPayments para que la pestaña Pagos los muestre en amarillo,
  // y el frontend los filtra de emparejamiento/sin-coincidencias via matchedPaymentIds.
  // Fuente: tabla registro_log (getConfirmedMarks) + retainedPaymentIds (backup
  // de IDs preservados al borrar registro).
  const confirmedMarks = await getConfirmedMarks()
  const confirmedIds = new Set<string>([
    ...confirmedMarks
      .map(m => m.mpPaymentId)
      .filter((id): id is string => !!id),
    ...(state.retainedPaymentIds || []),
  ])

  const storeEntries = Object.values(stores)

  // Traer órdenes pendientes de todas las tiendas (TiendaNube y Shopify)
  // Usa cutoff de ÓRDENES: max(48h_ago, HARD_CUTOFF_ORDERS)
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => {
      const platform = s.platform ?? 'tiendanube'
      if (platform === 'shopify') {
        return getShopifyOrders(s.storeId, s.accessToken, s.storeName, sinceOrders)
      }
      return getTNOrders(s.storeId, s.accessToken, s.storeName, sinceOrders)
    })
  )
  allOrdersPerStore.forEach((r, i) => {
    if (r.status === 'rejected') {
      const platform = storeEntries[i].platform ?? 'tiendanube'
      result.errors.push(`${platform} fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
      appendError(state, platform, 'warning',
        `Error al traer órdenes de tienda "${storeEntries[i].storeName}"`,
        { storeId: storeEntries[i].storeId, storeName: storeEntries[i].storeName, error: String(r.reason) }
      )
    }
  })

  // Nuevos pagos a agregar a la cola (colectados aparte para merge seguro al final)
  const newUnmatchedToAdd: UnmatchedPayment[] = []
  for (const payment of newPayments) {
    processedSet.add(payment.mpPaymentId)
    if (confirmedIds.has(payment.mpPaymentId)) continue

    newUnmatchedToAdd.push({
      payment,
      timestamp: nowART(),
      mpPaymentId: payment.mpPaymentId,
    })
    result.newUnmatched++
  }

  // ─── Sección crítica: recarga fresca + merge + guardado, BAJO EL LOCK ───────
  // Serializa con los matches/dismisses manuales (que también toman el lock).
  // El fetch lento de MP y de órdenes ya ocurrió arriba SIN candado (es solo
  // lectura); acá tomamos el lock solo para la fusión y el guardado, que son
  // rápidos. Sin este candado había un "lost update": si un match manual guardaba
  // entre el loadState() y el saveState() de este ciclo, el ciclo escribía último
  // con una vista vieja y re-agregaba a la cola un pago ya emparejado (fantasma).
  await withStateLock('cycle', 'sync-merge', async () => {
  // Re-cargar estado fresco antes de guardar: si un usuario hizo match/dismiss
  // mientras este ciclo corría, sus cambios en unmatchedPayments quedarían
  // sobreescritos si usáramos el state cargado al inicio. Recargamos y hacemos
  // merge solo de lo nuevo.
  const freshState = await loadState()

  // 1. Purge en el estado fresco (eliminar pagos vencidos). Los pagos de
  // billeteras "sin vencimiento" (ver WALLETS_SIN_VENCIMIENTO) se conservan
  // indefinidamente mientras no estén marcados como externos.
  const externallyMarkedIds = new Set((freshState.externallyMarkedPayments ?? []).map(e => e.id))
  freshState.unmatchedPayments = freshState.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    if (date >= purgeCutoff) return true
    const wallet = paymentWalletId(u.payment.source)
    const id = u.mpPaymentId || u.payment.mpPaymentId
    return !!wallet && WALLETS_SIN_VENCIMIENTO.includes(wallet) && !externallyMarkedIds.has(id)
  })

  // 2. Agregar nuevos pagos (sin duplicados)
  const freshUnmatchedIds = new Set(freshState.unmatchedPayments.map(u => u.payment.mpPaymentId))
  for (const u of newUnmatchedToAdd) {
    if (!freshUnmatchedIds.has(u.payment.mpPaymentId)) {
      freshState.unmatchedPayments.push(u)
    }
  }

  // ─── Enriquecimiento de nombres por CUIT (solo pagos nuevos) ──────────────
  // Se hace DESPUÉS de cargar freshState para que los overrides queden en el
  // estado que se va a guardar (antes estaban en state y se pisaban con freshState).
  // Máximo 3 por ciclo para no saturar cuitonline.com.
  // "~" = CUIT consultado pero no encontrado → no reintentar.
  const cuitLookupCandidatos = newUnmatchedToAdd
    .filter(u => {
      if (!u.payment.cuitPagador || u.payment.nombrePagador) return false
      const existing = freshState.paymentOverrides?.[u.payment.mpPaymentId]?.nombrePagador
      return !existing // omitir si ya tiene nombre guardado
    })
    .slice(0, 3)

  if (cuitLookupCandidatos.length > 0) {
    freshState.paymentOverrides = freshState.paymentOverrides || {}
    for (const u of cuitLookupCandidatos) {
      const nombre = await lookupNombreByCuit(u.payment.cuitPagador)
      if (nombre) {
        freshState.paymentOverrides[u.payment.mpPaymentId] = {
          ...freshState.paymentOverrides[u.payment.mpPaymentId],
          nombrePagador: nombre,
        }
      }
    }
  }

  // 3. Aplicar paymentOverrides — solo sobre campos que MP trae vacíos
  const overrides = freshState.paymentOverrides || {}
  for (const u of freshState.unmatchedPayments) {
    const override = overrides[u.payment.mpPaymentId]
    if (!override) continue
    for (const [key, value] of Object.entries(override)) {
      const current = u.payment[key as keyof typeof u.payment]
      if ((!current || current === '') && value) {
        ;(u.payment as unknown as Record<string, unknown>)[key] = value
      }
    }
  }

  // 4. Limpiar overrides cuyos pagos ya vencieron (hacer acá, no en saveState, para no borrarlos durante el reset)
  if (freshState.paymentOverrides && Object.keys(freshState.paymentOverrides).length > 0) {
    const activeIds = new Set(freshState.unmatchedPayments.map(u => u.payment.mpPaymentId))
    for (const id of Object.keys(freshState.paymentOverrides)) {
      if (!activeIds.has(id)) delete freshState.paymentOverrides[id]
    }
  }

  // 5. Merge de processedPayments (unión de ambos sets)
  const mergedProcessed = new Set([...freshState.processedPayments, ...Array.from(processedSet)])
  freshState.processedPayments = Array.from(mergedProcessed)

  // 6. Campos exclusivos del ciclo
  freshState.lastMPCheck = now.toISOString()

  // 7. Actualizar cache de órdenes — preservando tiendas que fallaron.
  //
  // Si una tienda falla el fetch, NO descartamos sus órdenes anteriores: las
  // mantenemos del cache previo para que sameMontoCount siga siendo correcto.
  // Solo se reescriben las órdenes de tiendas que respondieron OK.
  const failedStoreIds = new Set<string>()
  const successfulOrders: typeof freshState.cachedOrders = []

  allOrdersPerStore.forEach((r, i) => {
    const store = storeEntries[i]
    if (r.status === 'fulfilled') {
      // Las tiendas ya no están vinculadas a una billetera: cualquier pago puede
      // emparejar con cualquier tienda, así que no se propaga ninguna billetera.
      successfulOrders.push(...r.value)
    } else {
      failedStoreIds.add(store.storeId)
    }
  })

  const anyFulfilled = allOrdersPerStore.some(r => r.status === 'fulfilled')
  if (anyFulfilled || failedStoreIds.size > 0) {
    const previousOrders = freshState.cachedOrders ?? []
    const preservedOrders = failedStoreIds.size > 0
      ? previousOrders.filter(o => failedStoreIds.has(o.storeId))
      : []
    freshState.cachedOrders = [...successfulOrders, ...preservedOrders]
    if (anyFulfilled) freshState.cachedOrdersAt = now.toISOString()
  }

  // 8. Merge de errorLog agregado en este ciclo
  const freshErrorIds = new Set(freshState.errorLog.map(e => e.id))
  for (const e of state.errorLog) {
    if (!freshErrorIds.has(e.id)) freshState.errorLog.push(e)
  }

  // 9. Merge de activityLog agregado en este ciclo
  const freshActivityIds = new Set(freshState.activityLog.map(a => a.id))
  for (const a of state.activityLog) {
    if (!freshActivityIds.has(a.id)) freshState.activityLog.push(a)
  }

  await saveState(freshState)
  }) // fin de withStateLock (sección crítica)

  await audit({
    category: 'system', action: 'sync.end', result: result.errors.length > 0 ? 'partial' : 'success',
    actor: 'system', component: 'cycle',
    message: `Ciclo sync finalizado: ${result.processed} nuevos, ${result.newUnmatched} sin match, ${result.errors.length} errores`,
    meta: { processed: result.processed, newUnmatched: result.newUnmatched, errorCount: result.errors.length },
  })

  result.stores = stores
  return result
}
