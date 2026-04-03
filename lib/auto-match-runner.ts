// Lógica central del auto-match — compartida por el cron (reevaluar) y el botón manual
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, loadOrdersCache, incrementPersistedMonthStats, appendError, appendActivity } from './storage'
import { markOrderAsPaid as markTNOrderAsPaid } from './tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from './shopify'
import { findAutoMatchCandidates } from './auto-match'
import type { Store, LogEntry } from './types'

interface AutoMatchResult {
  matched: number
  errors: string[]
}

export async function runAutoMatchCore(
  stores: Record<string, Store>,
  triggeredBy: 'cron' | 'manual_button',
): Promise<AutoMatchResult> {
  const [hot, logs, matchLogData, ordersCache] = await Promise.all([
    loadHotState(), loadLogs(), loadMatchLog(), loadOrdersCache()
  ])

  const confirmedIds = new Set<string>([
    ...logs.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...matchLogData.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...(hot.retainedPaymentIds ?? []),
  ])

  const candidates = findAutoMatchCandidates(
    hot.unmatchedPayments,
    ordersCache.cachedOrders ?? [],
    hot.dismissedPairs ?? [],
    confirmedIds,
  )

  let matched = 0
  const errors: string[] = []
  const usedOrderIds = new Set<string>()

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const store = stores[candidate.storeId]
    if (!store) continue

    if (usedOrderIds.has(candidate.orderId)) {
      console.log(`[auto-match] Orden #${candidate.order.orderNumber} ya emparejada en esta corrida — saltando pago ${candidate.mpPaymentId}`)
      continue
    }

    // Verificar que el pago siga sin emparejar antes de llamar a la API (#3)
    const preCheckHot = await loadHotState()
    const stillExists = preCheckHot.unmatchedPayments.some(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId
    )
    if (!stillExists) {
      console.log(`[auto-match] Pago ${candidate.mpPaymentId} ya no existe en unmatchedPayments — saltando`)
      continue
    }

    const platform = store.platform ?? 'tiendanube'
    let markSuccess = false
    let markError: string | undefined

    // Recargar logs frescos antes de cada iteración para no pisar cambios concurrentes (#A2)
    const [freshLogs, freshMatchLog] = await Promise.all([loadLogs(), loadMatchLog()])

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
          appendError(freshLogs, 'auto-match', 'warning',
            `Pago verificado, error de API no permitió marcar automaticamente. Orden: #${candidate.order.orderNumber}`,
            { orderId: candidate.orderId, storeId: candidate.storeId, storeName: store.storeName }
          )
        }
      }
    } catch (err) {
      markError = String(err)
    }

    if (!markSuccess) {
      // Si la orden está cancelada/cerrada (422 "not OPEN"), saltarla silenciosamente
      // sin marcarla como nada — puede reabrirse y volver a ser válida
      const isNotOpen = markError?.includes('422') && markError?.includes('OPEN')
      if (isNotOpen) {
        console.log(`[auto-match] Orden #${candidate.order.orderNumber} no está en estado OPEN — saltando`)
        continue
      }
      appendError(freshLogs, 'auto-match', 'error',
        `Error al marcar orden #${candidate.order.orderNumber} como pagada (auto-match)`,
        { orderId: candidate.orderId, storeId: candidate.storeId, error: markError }
      )
      errors.push(`${candidate.orderId}: ${markError}`)
      await saveLogs(freshLogs)
      continue
    }

    // Recargar hot state fresco para no pisar cambios concurrentes
    const freshHot = await loadHotState()

    const idx = freshHot.unmatchedPayments.findIndex(u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId)
    if (idx < 0) {
      // Pago ya fue procesado por otro proceso concurrente — no duplicar stats/logs
      console.log(`[auto-match] Pago ${candidate.mpPaymentId} ya no está en unmatchedPayments después de marcar — saltando registro`)
      continue
    }
    freshHot.unmatchedPayments.splice(idx, 1)

    incrementPersistedMonthStats(freshHot, candidate.payment.monto, 'emparejamiento')

    freshHot.recentMatches = freshHot.recentMatches ?? []
    freshHot.recentMatches.push({
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
    freshLogs.registroLog.push(logEntry)
    freshMatchLog.matchLog.push(logEntry)

    appendActivity(freshLogs, 'system', 'pago_auto_emparejado', {
      mpPaymentId: candidate.mpPaymentId,
      monto: candidate.payment.monto,
      orderNumber: candidate.order.orderNumber,
      orderId: candidate.orderId,
      storeName: store.storeName,
    })

    matched++
    usedOrderIds.add(candidate.orderId)

    // registroLog primero — es la fuente de verdad; si falla, se propaga el error
    await saveLogs(freshLogs)
    await Promise.all([saveHotState(freshHot), saveMatchLog(freshMatchLog)])

    // 5s entre marcados para respetar rate limits
    if (i < candidates.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // Recargar hot state una última vez y guardar estado final
  const finalHot = await loadHotState()
  finalHot.lastAutoMatchAt = new Date().toISOString()
  finalHot.lastAutoMatchMatched = matched
  finalHot.currentPhase = 'idle'
  await saveHotState(finalHot)

  console.log(`[auto-match] matched: ${matched}, errors: ${errors.length}`)
  return { matched, errors }
}
