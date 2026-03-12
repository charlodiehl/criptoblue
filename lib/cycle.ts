import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders } from './tiendanube'
import { loadState, saveState, getStores } from './storage'
import type { UnmatchedPayment } from './types'

interface CycleResult {
  processed: number
  errors: string[]
}

export async function processMPPayments(): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, errors: [] }

  const [state, stores] = await Promise.all([loadState(), getStores()])

  const now = new Date()
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  // Purge pagos sin identificar con más de 48h
  state.unmatchedPayments = state.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= cutoff48h
  })

  // Limpiar pendingMatches (ya no se usa en el flujo manual)
  state.pendingMatches = []

  // Traer pagos aprobados de las últimas 48h desde MP
  let payments
  try {
    payments = await fetchAllPaymentsSince(cutoff48h)
  } catch (err) {
    result.errors.push(`MP fetch error: ${String(err)}`)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  // Traer órdenes pendientes de las últimas 48h desde TiendaNube
  // (solo se usan en el frontend para el matching manual, no aquí)
  const storeEntries = Object.values(stores)
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, 48))
  )
  allOrdersPerStore.forEach((r, i) => {
    if (r.status === 'rejected') {
      result.errors.push(`TN fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
    }
  })

  // Todos los pagos nuevos van a la cola de revisión manual
  for (const payment of newPayments) {
    processedSet.add(payment.mpPaymentId)

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
