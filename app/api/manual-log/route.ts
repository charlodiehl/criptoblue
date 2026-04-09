import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, getStores, incrementPersistedMonthStats, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Order } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'manual-log'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }
    const { mpPaymentId, storeName, orderNumber, matchedOrder } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const [hot, logs, matchLogData] = await Promise.all([loadHotState(), loadLogs(), loadMatchLog()])

    const unmatchedIndex = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const payment = hot.unmatchedPayments[unmatchedIndex].payment

    // Validación 1: la orden ya fue registrada como pagada (con cualquier pago)
    if (matchedOrder?.orderId) {
      const orderAlreadyPaid = logs.registroLog.some(e =>
        e.orderId === matchedOrder.orderId && !e.hidden &&
        (e.action === 'manual_paid' || e.action === 'auto_paid')
      )
      if (orderAlreadyPaid) {
        auditMatch({ action: 'manual_log.order_already_paid_blocked', actor: 'human', component: 'api/manual-log', mpPaymentId, orderId: matchedOrder.orderId, orderNumber: matchedOrder.orderNumber || orderNumber || '', storeId: matchedOrder.storeId || '', storeName: matchedOrder.storeName || storeName || '', amount: payment.monto, result: 'skipped', message: `Orden ya registrada: ${matchedOrder.orderId}` })
        return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
      }
    }

    // Validación 2: el pago ya fue emparejado con alguna orden
    const paymentAlreadyUsed = logs.registroLog.some(e =>
      e.mpPaymentId === mpPaymentId && !e.hidden &&
      (e.action === 'manual_paid' || e.action === 'auto_paid')
    )
    if (paymentAlreadyUsed) {
      auditMatch({ action: 'manual_log.payment_already_used_blocked', actor: 'human', component: 'api/manual-log', mpPaymentId, orderId: matchedOrder?.orderId || '', orderNumber: matchedOrder?.orderNumber || orderNumber || '', storeId: matchedOrder?.storeId || '', storeName: matchedOrder?.storeName || storeName || '', amount: payment.monto, result: 'skipped', message: `Pago ya emparejado: ${mpPaymentId}` })
      return NextResponse.json({ error: 'Este pago ya fue emparejado con otra orden' }, { status: 409 })
    }

    let markMethod: string | null = null
    let markError: string | undefined

    // Si hay una orden macheada, marcarla como pagada en la plataforma correspondiente
    if (matchedOrder) {
      const stores = await getStores()
      const store = stores[matchedOrder.storeId]
      if (store) {
        const platform = store.platform ?? 'tiendanube'
        try {
          if (platform === 'shopify') {
            const result = await markShopifyOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId, payment.monto)
            if (result.success) markMethod = 'shopify'
            else markError = result.error
          } else {
            const result = await markTNOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId)
            if (result.success) {
              markMethod = result.method
              if (result.method === 'note') {
                appendActivity(logs, 'system', 'mark_api_note', {
                  message: `Pago verificado, error de API no permitió marcar automaticamente. Orden: #${matchedOrder.orderNumber}`,
                  orderId: matchedOrder.orderId, storeId: matchedOrder.storeId,
                })
              }
            } else {
              markError = result.error
            }
          }
        } catch (err) {
          markError = String(err)
        }

        if (markError) {
          appendActivity(logs, 'system', 'mark_api_error', {
            message: `Error al marcar orden #${matchedOrder.orderNumber} como pagada en ${platform}`,
            orderId: matchedOrder.orderId, storeId: matchedOrder.storeId, error: markError,
          })
        }
      }
    }

    hot.unmatchedPayments.splice(unmatchedIndex, 1)

    incrementPersistedMonthStats(hot, payment.monto, 'manual_pagos')

    const order: Order | undefined = matchedOrder || undefined

    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId: payment.mpPaymentId,
      matchedAt: nowART(),
      orderId: order?.orderId,
      storeId: order?.storeId,
      order,
      payment,
    })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'manual_pagos',
      triggeredBy: 'human',
      payment,
      order,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderTotal: order?.total,
      orderNumber: order?.orderNumber || orderNumber || '',
      orderId: order?.orderId,
      storeId: order?.storeId,
      storeName: order?.storeName || storeName || '',
      customerName: order?.customerName,
      paymentReceivedAt: payment.fechaPago,
      orderCreatedAt: order?.createdAt,
    }
    logs.registroLog.push(logEntry)
    matchLogData.matchLog.push(logEntry)

    appendActivity(logs, 'human', 'pago_registrado_manual', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order?.orderNumber || orderNumber || '',
      storeName: order?.storeName || storeName || '',
    })
    auditMatch({ action: 'manual_log.paid', actor: 'human', component: 'api/manual-log', mpPaymentId: payment.mpPaymentId, orderId: order?.orderId || '', orderNumber: order?.orderNumber || orderNumber || '', storeId: order?.storeId || '', storeName: order?.storeName || storeName || '', amount: payment.monto, result: 'success', message: `Log manual: ${payment.mpPaymentId}` })

    // registroLog primero — es la fuente de verdad; si falla, el endpoint devuelve error
    await saveLogs(logs)
    await Promise.all([saveHotState(hot), saveMatchLog(matchLogData)])

    const recentMatch = {
      mpPaymentId: payment.mpPaymentId,
      matchedAt: logEntry.timestamp,
      orderId: order?.orderId,
      storeId: order?.storeId,
      order,
      payment,
    }

    return NextResponse.json({ success: true, markMethod, markError, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
