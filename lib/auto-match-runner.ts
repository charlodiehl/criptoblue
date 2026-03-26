// Lógica central del auto-match — compartida por el cron (reevaluar) y el botón manual
import { saveState, getStores, incrementPersistedMonthStats, appendError, appendActivity } from './storage'
import { markOrderAsPaid as markTNOrderAsPaid } from './tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from './shopify'
import { findAutoMatchCandidates } from './auto-match'
import type { AppState, Store, LogEntry } from './types'

interface AutoMatchResult {
  matched: number
  errors: string[]
}

export async function runAutoMatchCore(
  state: AppState,
  stores: Record<string, Store>,
  triggeredBy: 'cron' | 'manual_button',
): Promise<AutoMatchResult> {
  const confirmedIds = new Set<string>([
    ...state.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...(state.retainedPaymentIds || []),
  ])

  const candidates = findAutoMatchCandidates(
    state.unmatchedPayments,
    state.cachedOrders || [],
    state.dismissedPairs || [],
    confirmedIds,
  )

  let matched = 0
  const errors: string[] = []

  for (const candidate of candidates) {
    const store = stores[candidate.storeId]
    if (!store) continue

    const platform = store.platform ?? 'tiendanube'
    let markSuccess = false
    let markError: string | undefined

    try {
      if (platform === 'shopify') {
        const result = await markShopifyOrderAsPaid(candidate.storeId, store.accessToken, candidate.orderId, candidate.order.total)
        markSuccess = result.success
        markError = result.error
      } else {
        const result = await markTNOrderAsPaid(candidate.storeId, store.accessToken, candidate.orderId)
        markSuccess = result.success
        markError = result.error
        if (result.success && result.method === 'note') {
          appendError(state, 'auto-match', 'warning',
            `TiendaNube no permitió cambiar estado (403/422) — solo se agregó nota. Orden: #${candidate.order.orderNumber}`,
            { orderId: candidate.orderId, storeId: candidate.storeId, storeName: store.storeName }
          )
        }
      }
    } catch (err) {
      markError = String(err)
    }

    if (!markSuccess) {
      appendError(state, 'auto-match', 'error',
        `Error al marcar orden #${candidate.order.orderNumber} como pagada (auto-match)`,
        { orderId: candidate.orderId, storeId: candidate.storeId, error: markError }
      )
      errors.push(`${candidate.orderId}: ${markError}`)
      continue
    }

    // Eliminar el pago de la cola de pendientes
    const idx = state.unmatchedPayments.findIndex(u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId)
    if (idx >= 0) state.unmatchedPayments.splice(idx, 1)

    incrementPersistedMonthStats(state, candidate.payment.monto, 'emparejamiento')

    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({
      mpPaymentId: candidate.mpPaymentId,
      matchedAt: new Date().toISOString(),
      orderId: candidate.orderId,
      storeId: candidate.storeId,
      order: candidate.order,
      payment: candidate.payment,
    })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'auto_paid',
      source: 'emparejamiento',
      triggeredBy,
      payment: candidate.payment,
      order: candidate.order,
      mpPaymentId: candidate.mpPaymentId,
      amount: candidate.payment.monto,
      orderNumber: candidate.order.orderNumber,
      orderId: candidate.orderId,
      storeId: candidate.storeId,
      storeName: store.storeName,
      customerName: candidate.order.customerName,
      paymentReceivedAt: candidate.payment.fechaPago,
      orderCreatedAt: candidate.order.createdAt,
    }
    state.registroLog.push(logEntry)
    state.matchLog.push(logEntry)

    appendActivity(state, 'system', 'pago_auto_emparejado', {
      mpPaymentId: candidate.mpPaymentId,
      monto: candidate.payment.monto,
      orderNumber: candidate.order.orderNumber,
      orderId: candidate.orderId,
      storeName: store.storeName,
    })

    matched++

    // Guardar después de cada match para que el frontend lo vea en tiempo real
    await saveState(state)

    // 5s entre marcados para respetar rate limits de TiendaNube/Shopify
    if (candidates.indexOf(candidate) < candidates.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  state.lastAutoMatchAt = new Date().toISOString()
  state.lastAutoMatchMatched = matched
  state.currentPhase = 'idle'
  await saveState(state)

  console.log(`[auto-match] matched: ${matched}, errors: ${errors.length}`)
  return { matched, errors }
}
