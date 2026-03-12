import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders, markOrderAsPaid } from './tiendanube'
import { loadState, saveState, getStores, getMatchId } from './storage'
import { findBestMatch } from './matcher'
import type { PendingMatch, UnmatchedPayment, LogEntry } from './types'

interface CycleResult {
  processed: number
  autoPaid: number
  needsReview: number
  noMatch: number
  errors: string[]
}

export async function processMPPayments(): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, autoPaid: 0, needsReview: 0, noMatch: 0, errors: [] }

  const [state, stores] = await Promise.all([loadState(), getStores()])

  const now = new Date()
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  // Purge unmatched payments older than 48h
  state.unmatchedPayments = state.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= cutoff48h
  })

  // Purge pendingMatches older than 48h (por matchedAt o por createdAt de la orden)
  state.pendingMatches = state.pendingMatches.filter(m => {
    const matchDate = m.matchedAt ? new Date(m.matchedAt) : null
    const orderDate = m.order?.createdAt ? new Date(m.order.createdAt) : null
    const ref = matchDate || orderDate
    return ref ? ref >= cutoff48h : true
  })

  // Siempre traer las últimas 48h desde MP
  const sinceDate = cutoff48h

  let payments
  try {
    payments = await fetchAllPaymentsSince(sinceDate)
  } catch (err) {
    const msg = String(err)
    result.errors.push(`MP fetch error: ${msg}`)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  const storeEntries = Object.values(stores)
  // Traer solo órdenes con payment_status=pending de las últimas 48h
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, 48))
  )

  const allOrders = allOrdersPerStore.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value
    result.errors.push(`TN fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
    return []
  })

  // Purge pendingMatches cuya orden ya no está en estado pending en TiendaNube (canceladas o pagadas)
  const pendingOrderIds = new Set(allOrders.map(o => o.orderId))
  state.pendingMatches = state.pendingMatches.filter(m => pendingOrderIds.has(m.order.orderId))

  for (const payment of newPayments) {
    processedSet.add(payment.mpPaymentId)

    const match = findBestMatch(payment, allOrders)

    if (!match) {
      result.noMatch++
      const unmatched: UnmatchedPayment = {
        payment,
        timestamp: new Date().toISOString(),
        mpPaymentId: payment.mpPaymentId,
      }
      state.unmatchedPayments.push(unmatched)

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        action: 'no_match',
        payment,
        mpPaymentId: payment.mpPaymentId,
        amount: payment.monto,
      }
      state.matchLog.push(logEntry)
      continue
    }

    const store = stores[match.order.storeId]
    const pendingMatch: PendingMatch = {
      payment,
      order: match.order,
      score: match.score,
      scores: match.scores,
      matchType: match.matchType,
      thirdParty: match.thirdParty,
      matchedAt: new Date().toISOString(),
      mpPaymentId: payment.mpPaymentId,
      storeName: match.order.storeName,
    }

    if (match.decision === 'auto_paid' && store) {
      try {
        const tnResult = await markOrderAsPaid(
          match.order.storeId,
          store.accessToken,
          match.order.orderId,
          { mpPaymentId: payment.mpPaymentId, amount: payment.monto }
        )

        if (tnResult.success) {
          result.autoPaid++
          const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            action: 'auto_paid',
            payment,
            order: match.order,
            score: match.score,
            mpPaymentId: payment.mpPaymentId,
            amount: payment.monto,
            orderNumber: match.order.orderNumber,
            orderId: match.order.orderId,
            storeId: match.order.storeId,
            storeName: match.order.storeName,
            customerName: match.order.customerName,
          }
          state.matchLog.push(logEntry)
        } else {
          result.needsReview++
          const matchWithId = { ...pendingMatch, mpPaymentId: payment.mpPaymentId }
          const existing = state.pendingMatches.findIndex(m => getMatchId(m) === getMatchId(matchWithId))
          if (existing >= 0) {
            state.pendingMatches[existing] = matchWithId
          } else {
            state.pendingMatches.push(matchWithId)
          }
        }
      } catch (err) {
        result.needsReview++
        const matchWithId = { ...pendingMatch, mpPaymentId: payment.mpPaymentId }
        const existing = state.pendingMatches.findIndex(m => getMatchId(m) === getMatchId(matchWithId))
        if (existing < 0) state.pendingMatches.push(matchWithId)
        result.errors.push(`markOrderAsPaid error: ${err}`)
      }
    } else {
      result.needsReview++
      const matchWithId = { ...pendingMatch, mpPaymentId: payment.mpPaymentId }
      const existing = state.pendingMatches.findIndex(m => getMatchId(m) === getMatchId(matchWithId))
      if (existing >= 0) {
        state.pendingMatches[existing] = matchWithId
      } else {
        state.pendingMatches.push(matchWithId)
      }

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        action: 'needs_review',
        payment,
        order: match.order,
        score: match.score,
        mpPaymentId: payment.mpPaymentId,
        amount: payment.monto,
        orderNumber: match.order.orderNumber,
        orderId: match.order.orderId,
        storeId: match.order.storeId,
        storeName: match.order.storeName,
        customerName: match.order.customerName,
      }
      state.matchLog.push(logEntry)
    }
  }

  state.processedPayments = Array.from(processedSet)
  state.lastMPCheck = now.toISOString()

  await saveState(state)

  return result
}
