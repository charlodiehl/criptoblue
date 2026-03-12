import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders, cancelAbandonedOrders } from './tiendanube'
import { loadState, saveState, getStores } from './storage'
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

  // Purge pagos con más de 24h (un pago no usado en 24h no va a matchear)
  state.unmatchedPayments = state.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= cutoff24h
  })

  // Limpiar pendingMatches (ya no se usa en el flujo manual)
  state.pendingMatches = []

  // Traer pagos aprobados de las últimas 24h desde MP
  let payments
  try {
    payments = await fetchAllPaymentsSince(cutoff24h)
  } catch (err) {
    result.errors.push(`MP fetch error: ${String(err)}`)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  // IDs de pagos ya confirmados (no deben reaparecer en la cola)
  const confirmedIds = new Set(
    state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)
  )

  // Cancelar órdenes abandonadas (payment_status=pending con más de 48h)
  const storeEntries = Object.values(stores)
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
