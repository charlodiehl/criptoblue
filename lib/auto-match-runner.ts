// Lógica central del auto-match — compartida por el cron (reevaluar) y el botón manual
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, loadOrdersCache, incrementPersistedMonthStats, appendError, appendActivity, waitForLock, releaseLock } from './storage'
import { markOrderAsPaid as markTNOrderAsPaid } from './tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from './shopify'
import { findAutoMatchCandidates } from './auto-match'
import type { Store, LogEntry } from './types'
import { auditBatch } from './audit'
import type { AuditParams } from './audit'
import { nowART } from './utils'

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

  // Cola de audit — se escribe toda junta al final del ciclo (1 read+write en vez de N)
  const auditQueue: AuditParams[] = []
  auditQueue.push({ category: 'system', action: 'auto_match.start', result: 'success', actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'auto-match-runner', message: `Auto-match iniciado: ${candidates.length} candidatos`, meta: { candidateCount: candidates.length, triggeredBy } })

  let matched = 0
  const errors: string[] = []
  const usedOrderIds = new Set<string>()

  const LOCK_HOLDER = 'auto-match'

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const store = stores[candidate.storeId]
    if (!store) continue

    if (usedOrderIds.has(candidate.orderId)) {
      console.log(`[auto-match] Orden #${candidate.order.orderNumber} ya emparejada en esta corrida — saltando pago ${candidate.mpPaymentId}`)
      auditQueue.push({ category: 'match', action: 'auto_match.skipped_order_used', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Orden #${candidate.order.orderNumber} ya emparejada`, orderNumber: candidate.order.orderNumber, mpPaymentId: candidate.mpPaymentId })
      continue
    }

    // Adquirir lock global — esperar si hay una operación manual en curso
    const lockAcquired = await waitForLock(LOCK_HOLDER, `orden #${candidate.order.orderNumber}`, 15_000, 1000)
    if (!lockAcquired) {
      console.log(`[auto-match] No se pudo adquirir lock para #${candidate.order.orderNumber} — saltando`)
      auditQueue.push({ category: 'lock', action: 'lock.timeout', result: 'failure', actor: 'system', component: 'auto-match-runner', message: `Lock no adquirido para #${candidate.order.orderNumber}`, orderNumber: candidate.order.orderNumber })
      continue
    }

    try {
    // Verificar que el pago siga sin emparejar y que el par no haya sido descartado (#3)
    const preCheckHot = await loadHotState()
    const stillExists = preCheckHot.unmatchedPayments.some(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId
    )
    if (!stillExists) {
      console.log(`[auto-match] Pago ${candidate.mpPaymentId} ya no existe en unmatchedPayments — saltando`)
      auditQueue.push({ category: 'match', action: 'auto_match.skipped_gone', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Pago ${candidate.mpPaymentId} ya no existe`, mpPaymentId: candidate.mpPaymentId })
      continue
    }

    // Re-validar dismissedPairs frescos — puede haberse descartado mientras el loop corría
    const freshDismissedSet = new Set(
      (preCheckHot.dismissedPairs ?? []).map(p => `${p.mpPaymentId}|${p.orderId}|${p.storeId}`)
    )
    if (freshDismissedSet.has(`${candidate.mpPaymentId}|${candidate.orderId}|${candidate.storeId}`)) {
      console.log(`[auto-match] Par ${candidate.mpPaymentId}+${candidate.order.orderNumber} fue descartado — saltando`)
      auditQueue.push({ category: 'match', action: 'auto_match.skipped_dismissed', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Par descartado`, mpPaymentId: candidate.mpPaymentId, orderNumber: candidate.order.orderNumber })
      continue
    }

    const platform = store.platform ?? 'tiendanube'
    let markSuccess = false
    let markError: string | undefined

    // Recargar logs frescos antes de cada iteración para no pisar cambios concurrentes (#A2)
    const [freshLogs, freshMatchLog] = await Promise.all([loadLogs(), loadMatchLog()])

    // Validación extra: la orden no fue marcada como pagada manualmente mientras corría este ciclo
    const orderAlreadyInRegistro = freshLogs.registroLog.some(e =>
      e.orderId === candidate.orderId && !e.hidden &&
      (e.action === 'manual_paid' || e.action === 'auto_paid')
    )
    if (orderAlreadyInRegistro) {
      console.log(`[auto-match] Orden #${candidate.order.orderNumber} ya está en registroLog — saltando`)
      auditQueue.push({ category: 'match', action: 'auto_match.skipped_order_in_registro', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Orden #${candidate.order.orderNumber} ya registrada`, orderNumber: candidate.order.orderNumber, mpPaymentId: candidate.mpPaymentId })
      continue
    }

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
        auditQueue.push({ category: 'match', action: 'auto_match.skipped_not_open', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Orden #${candidate.order.orderNumber} no está OPEN`, orderNumber: candidate.order.orderNumber, error: markError })
        continue
      }
      appendError(freshLogs, 'auto-match', 'error',
        `Error al marcar orden #${candidate.order.orderNumber} como pagada (auto-match)`,
        { orderId: candidate.orderId, storeId: candidate.storeId, error: markError }
      )
      errors.push(`${candidate.orderId}: ${markError}`)
      auditQueue.push({ category: 'error', action: 'auto_match.mark_failed', result: 'failure', actor: 'system', component: 'auto-match-runner', message: `Error al marcar #${candidate.order.orderNumber}`, orderNumber: candidate.order.orderNumber, storeId: candidate.storeId, error: markError })
      await saveLogs(freshLogs)
      continue
    }

    // Recargar hot state fresco para no pisar cambios concurrentes
    const freshHot = await loadHotState()

    const idx = freshHot.unmatchedPayments.findIndex(u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId)
    if (idx < 0) {
      // Pago ya fue procesado por otro proceso concurrente — no duplicar stats/logs
      console.log(`[auto-match] Pago ${candidate.mpPaymentId} ya no está en unmatchedPayments después de marcar — saltando registro`)
      auditQueue.push({ category: 'match', action: 'auto_match.skipped_concurrent', result: 'skipped', actor: 'system', component: 'auto-match-runner', message: `Pago ${candidate.mpPaymentId} procesado concurrentemente`, mpPaymentId: candidate.mpPaymentId })
      continue
    }
    freshHot.unmatchedPayments.splice(idx, 1)

    incrementPersistedMonthStats(freshHot, candidate.payment.monto, 'emparejamiento')

    freshHot.recentMatches = freshHot.recentMatches ?? []
    freshHot.recentMatches.push({
      mpPaymentId: candidate.mpPaymentId,
      matchedAt: nowART(),
      orderId: candidate.orderId,
      storeId: candidate.storeId,
      order: candidate.order,
      payment: candidate.payment,
    })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'auto_paid',
      source: 'emparejamiento',
      triggeredBy,
      payment: candidate.payment,
      order: candidate.order,
      mpPaymentId: candidate.mpPaymentId,
      amount: candidate.payment.monto,
      orderTotal: candidate.order.total,
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
      auditQueue.push({ category: 'match', action: 'auto_match.paid', actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'auto-match-runner', mpPaymentId: candidate.mpPaymentId, orderId: candidate.orderId, orderNumber: candidate.order.orderNumber, storeId: candidate.storeId, storeName: store.storeName, amount: candidate.payment.monto, result: 'success', message: `Auto-match: ${candidate.mpPaymentId} → #${candidate.order.orderNumber} (${store.storeName})` })

    matched++
    usedOrderIds.add(candidate.orderId)

    // registroLog primero — es la fuente de verdad; si falla, se propaga el error
    await saveLogs(freshLogs)
    await Promise.all([saveHotState(freshHot), saveMatchLog(freshMatchLog)])

    } finally {
      await releaseLock(LOCK_HOLDER)
    }

    // 5s entre marcados para respetar rate limits
    if (i < candidates.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // Verificación post-auto-match: asegurar que todo lo que está en matchLog
  // también esté en registroLog. Si falta algo, recuperarlo.
  if (matched > 0) {
    const [verifyLogs, verifyMatchLog] = await Promise.all([loadLogs(), loadMatchLog()])
    const registroTs = new Set(verifyLogs.registroLog.map(e => e.timestamp))
    const registroOrders = new Set(verifyLogs.registroLog.map(e => e.orderNumber).filter(Boolean))
    let recovered = 0
    for (const entry of verifyMatchLog.matchLog) {
      if (!registroTs.has(entry.timestamp) && !registroOrders.has(entry.orderNumber)) {
        verifyLogs.registroLog.push(entry)
        recovered++
        console.log(`[auto-match] Recuperada entrada faltante en registroLog: #${entry.orderNumber}`)
        auditQueue.push({ category: 'system', action: 'auto_match.recovery', result: 'warning', actor: 'system', component: 'auto-match-runner', message: `Recuperada entrada: #${entry.orderNumber}`, orderNumber: entry.orderNumber })
      }
    }
    if (recovered > 0) {
      await saveLogs(verifyLogs)
      console.log(`[auto-match] ${recovered} entrada(s) recuperada(s) en registroLog`)
    }
  }

  // Recargar hot state una última vez y guardar estado final
  const finalHot = await loadHotState()
  finalHot.lastAutoMatchAt = nowART()
  finalHot.lastAutoMatchMatched = matched
  finalHot.currentPhase = 'idle'
  await saveHotState(finalHot)

  console.log(`[auto-match] matched: ${matched}, errors: ${errors.length}`)
  auditQueue.push({ category: 'system', action: 'auto_match.end', result: 'success', actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'auto-match-runner', message: `Auto-match fin: ${matched} emparejados, ${errors.length} errores`, meta: { matched, errorCount: errors.length } })

  // Flush: escribe todos los eventos del ciclo en un solo read+write (reduce IO masivamente)
  await auditBatch(auditQueue)

  return { matched, errors }
}
