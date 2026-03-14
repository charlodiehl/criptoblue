import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, getMatchId } from '@/lib/storage'
import { markOrderAsPaid, getPendingOrders } from '@/lib/tiendanube'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId, orderId, storeId, order: orderFromClient } = await req.json()
    if (!mpPaymentId || !orderId || !storeId) {
      return NextResponse.json({ error: 'mpPaymentId, orderId, storeId required' }, { status: 400 })
    }

    const [state, stores] = await Promise.all([loadState(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const unmatchedIndex = state.unmatchedPayments.findIndex(
      u => getMatchId(u) === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const unmatched = state.unmatchedPayments[unmatchedIndex]
    const payment = unmatched.payment

    // Usar la orden enviada por el cliente (ya la tiene en memoria).
    // Solo re-fetchear de TN si por algún motivo no vino en el body.
    let order = orderFromClient || null
    if (!order) {
      try {
        const orders = await getPendingOrders(storeId, store.accessToken, store.storeName)
        order = orders.find(o => o.orderId === orderId) || null
      } catch {
        // Si falla el fetch igual continuamos; el log quedará sin datos de orden
      }
    }

    const tnResult = await markOrderAsPaid(storeId, store.accessToken, orderId)

    console.log('[manual-match] TN result:', JSON.stringify(tnResult))

    if (!tnResult.success) {
      return NextResponse.json({ error: tnResult.error }, { status: 500 })
    }

    if (tnResult.method === 'note') {
      console.warn('[manual-match] WARNING: TN returned 403/422 for payment_status change. Only a note was added. Order may NOT be marked paid in TiendaNube.')
    }

    state.unmatchedPayments.splice(unmatchedIndex, 1)

    // recentMatches: para resaltado verde en pestañas (auto-limpia a las 24h, independiente del Registro)
    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({ mpPaymentId: payment.mpPaymentId, matchedAt: new Date().toISOString(), orderId, storeId })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'manual_paid',
      payment,
      order: order || undefined,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderNumber: order?.orderNumber,
      orderId,
      storeId,
      storeName: store.storeName,
      customerName: order?.customerName,
    }
    state.matchLog.push(logEntry)

    await saveState(state)

    return NextResponse.json({ success: true, method: tnResult.method })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
