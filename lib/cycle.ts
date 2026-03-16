import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders, cancelAbandonedOrders } from './tiendanube'
import { loadState, saveState, getStores } from './storage'
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
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  // Usar el más reciente entre el rolling 24h y el hard cutoff
  const since = cutoff24h > HARD_CUTOFF ? cutoff24h : HARD_CUTOFF

  // Purge pagos anteriores al cutoff efectivo
  state.unmatchedPayments = state.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= since
  })

  // Limpiar pendingMatches (ya no se usa en el flujo manual)
  state.pendingMatches = []

  // Traer pagos aprobados desde el cutoff efectivo
  let payments
  try {
    payments = await fetchAllPaymentsSince(since)
  } catch (err) {
    result.errors.push(`MP fetch error: ${String(err)}`)
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

  // Verificar órdenes pendientes recientes (solo para loggear errores de fetch)
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, 48))
  )
  allOrdersPerStore.forEach((r, i) => {
    if (r.status === 'rejected') {
      result.errors.push(`TN fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
    }
  })

  // Todos los pagos nuevos van a la cola de revisión manual (excepto los ya confirmados)
  for (const payment of newPayments) {
    processedSet.add(payment.mpPaymentId)
    if (confirmedIds.has(payment.mpPaymentId)) continue

    const unmatched: UnmatchedPayment = {
      payment,
      timestamp: new Date().toISOString(),
      mpPaymentId: payment.mpPaymentId,
    }
    state.unmatchedPayments.push(unmatched)
  }

  state.processedPayments = Array.from(processedSet)
  state.lastMPCheck = now.toISOString()

  await saveState(state)

  return result
}
