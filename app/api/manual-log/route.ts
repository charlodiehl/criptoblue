import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, getStores, incrementPersistedMonthStats, appendActivity } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Order } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId, storeName, orderNumber, matchedOrder } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const [hot, logs, matchLogData] = await Promise.all([loadHotState(), loadLogs(), loadMatchLog()])

    const unmatchedIndex = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const payment = hot.unmatchedPayments[unmatchedIndex].payment

    let markMethod: string | null = null

    // Si hay una orden macheada, marcarla como pagada en la plataforma correspondiente
    if (matchedOrder) {
      const stores = await getStores()
      const store = stores[matchedOrder.storeId]
      if (store) {
        const platform = store.platform ?? 'tiendanube'
        if (platform === 'shopify') {
          const result = await markShopifyOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId, payment.monto)
          if (result.success) markMethod = 'shopify'
        } else {
          const result = await markTNOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId)
          if (result.success) markMethod = result.method
        }
      }
    }

    hot.unmatchedPayments.splice(unmatchedIndex, 1)

    incrementPersistedMonthStats(hot, payment.monto, 'manual_pagos')

    const order: Order | undefined = matchedOrder || undefined

    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId: payment.mpPaymentId,
      matchedAt: new Date().toISOString(),
      orderId: order?.orderId,
      storeId: order?.storeId,
      order,
      payment,
    })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'manual_paid',
      source: 'manual_pagos',
      triggeredBy: 'human',
      payment,
      order,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
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

    await Promise.all([saveHotState(hot), saveLogs(logs), saveMatchLog(matchLogData)])

    const recentMatch = {
      mpPaymentId: payment.mpPaymentId,
      matchedAt: logEntry.timestamp,
      orderId: order?.orderId,
      storeId: order?.storeId,
      order,
      payment,
    }

    return NextResponse.json({ success: true, markMethod, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
