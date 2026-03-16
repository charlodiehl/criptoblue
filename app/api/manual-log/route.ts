import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, getMatchId, incrementMonthlyStats, appendActivity } from '@/lib/storage'
import { markOrderAsPaid } from '@/lib/tiendanube'
import type { LogEntry, Order } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId, storeName, orderNumber, matchedOrder } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const state = await loadState()

    const unmatchedIndex = state.unmatchedPayments.findIndex(
      u => getMatchId(u) === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const payment = state.unmatchedPayments[unmatchedIndex].payment

    let tnMethod: string | null = null

    // Si hay una orden macheada, intentar marcarla como pagada en TiendaNube
    if (matchedOrder) {
      const stores = await getStores()
      const store = stores[matchedOrder.storeId]
      if (store) {
        const tnResult = await markOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId)
        if (tnResult.success) {
          tnMethod = tnResult.method
        }
      }
    }

    state.unmatchedPayments.splice(unmatchedIndex, 1)

    incrementMonthlyStats(state, payment.monto)

    const order: Order | undefined = matchedOrder || undefined

    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({
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
      payment,
      order,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderNumber: order?.orderNumber || orderNumber || '',
      orderId: order?.orderId,
      storeId: order?.storeId,
      storeName: order?.storeName || storeName || '',
      customerName: order?.customerName,
    }
    state.matchLog.push(logEntry)

    appendActivity(state, 'human', 'pago_registrado_manual', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order?.orderNumber || orderNumber || '',
      storeName: order?.storeName || storeName || '',
    })

    await saveState(state)

    const recentMatch = {
      mpPaymentId: payment.mpPaymentId,
      matchedAt: logEntry.timestamp,
      orderId: order?.orderId,
      storeId: order?.storeId,
      order,
      payment,
    }

    return NextResponse.json({ success: true, tnMethod, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
