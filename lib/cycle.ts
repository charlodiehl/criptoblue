import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders, cancelAbandonedOrders } from './tiendanube'
import { loadState, saveState, getStores, appendError } from './storage'
import { HARD_CUTOFF } from './config'
import type { UnmatchedPayment } from './types'

interface CycleResult {
  processed: number
  cancelled: number
  errors: string[]
}

export async function processMPPayments(): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, cancelled: 0, errors: [] }

  const [state, stores] = await Promise.all([loadState(), getStores()])

  const now = new Date()
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  // Usar el más reciente entre el rolling 48h y el hard cutoff
  const since = cutoff48h > HARD_CUTOFF ? cutoff48h : HARD_CUTOFF

  // Purge pagos anteriores al cutoff efectivo
  const purge48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const purgeCutoff = purge48h > HARD_CUTOFF ? purge48h : HARD_CUTOFF

  // Limpiar pendingMatches (ya no se usa en el flujo manual)
  state.pendingMatches = []

  // Traer pagos aprobados desde el cutoff efectivo
  let payments
  try {
    payments = await fetchAllPaymentsSince(since)
  } catch (err) {
    result.errors.push(`MP fetch error: ${String(err)}`)
    appendError(state, 'mercadopago', 'error', `Error al traer pagos de MercadoPago: ${String(err)}`)
    await saveState(state)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  // IDs de pagos ya procesados (no deben reaparecer en la cola)
  // Incluye: confirmados via match, descartados, y marcados como recibidos externamente
  const confirmedIds = new Set<string>([
    ...state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id),
    ...(state.externallyMarkedPayments || []),
    ...(state.retainedPaymentIds || []),
  ])

  const storeEntries = Object.values(stores)

  // Cancelación automática de órdenes abandonadas — PAUSADA
  // Para reactivar: cambiar AUTO_CANCEL_ENABLED a true
  const AUTO_CANCEL_ENABLED = false
  if (AUTO_CANCEL_ENABLED) {
    const cancelResults = await Promise.allSettled(
      storeEntries.map(s => cancelAbandonedOrders(s.storeId, s.accessToken))
    )
    cancelResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        result.cancelled += r.value.cancelled
        if (r.value.errors > 0) {
          result.errors.push(`Cancel errors in store ${storeEntries[i].storeId}: ${r.value.errors}`)
        }
      } else {
        result.errors.push(`Cancel fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
      }
    })
  }

  // Traer órdenes pendientes de TiendaNube y cachearlas (todos los clientes leen de este cache)
  // IMPORTANTE: las órdenes siempre usan ventana fija de 48h — el HARD_CUTOFF aplica solo a pagos de MP
  const sinceHours = 48
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, sinceHours))
  )
  allOrdersPerStore.forEach((r, i) => {
    if (r.status === 'rejected') {
      result.errors.push(`TN fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
      appendError(state, 'tiendanube', 'warning',
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
      timestamp: new Date().toISOString(),
      mpPaymentId: payment.mpPaymentId,
    })
  }

  // ─── Re-cargar estado fresco antes de guardar ──────────────────────────────
  // Evita race condition: si un usuario hizo match/dismiss mientras este ciclo
  // corría, sus cambios en unmatchedPayments quedarían sobreescritos si usamos
  // el state cargado al inicio. Recargamos y hacemos merge solo de lo nuevo.
  const freshState = await loadState()

  // 1. Purge en el estado fresco (eliminar pagos vencidos)
  freshState.unmatchedPayments = freshState.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= purgeCutoff
  })

  // 2. Agregar nuevos pagos (sin duplicados)
  const freshUnmatchedIds = new Set(freshState.unmatchedPayments.map(u => u.payment.mpPaymentId))
  for (const u of newUnmatchedToAdd) {
    if (!freshUnmatchedIds.has(u.payment.mpPaymentId)) {
      freshState.unmatchedPayments.push(u)
    }
  }

  // 3. Merge de processedPayments (unión de ambos sets)
  const mergedProcessed = new Set([...freshState.processedPayments, ...Array.from(processedSet)])
  freshState.processedPayments = Array.from(mergedProcessed)

  // 4. Campos exclusivos del ciclo
  freshState.lastMPCheck = now.toISOString()
  freshState.pendingMatches = []

  // 5. Actualizar cache de órdenes (si al menos una tienda respondió)
  const anyFulfilled = allOrdersPerStore.some(r => r.status === 'fulfilled')
  if (anyFulfilled) {
    freshState.cachedOrders = allOrdersPerStore.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    freshState.cachedOrdersAt = now.toISOString()
  }

  // 6. Merge de errorLog agregado en este ciclo
  const freshErrorIds = new Set(freshState.errorLog.map(e => e.id))
  for (const e of state.errorLog) {
    if (!freshErrorIds.has(e.id)) freshState.errorLog.push(e)
  }

  // 7. Merge de activityLog agregado en este ciclo
  const freshActivityIds = new Set(freshState.activityLog.map(a => a.id))
  for (const a of state.activityLog) {
    if (!freshActivityIds.has(a.id)) freshState.activityLog.push(a)
  }

  await saveState(freshState)

  return result
}
