import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, getMatchId } from '@/lib/storage'
import { markOrderAsPaid } from '@/lib/tiendanube'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const [state, stores] = await Promise.all([loadState(), getStores()])

    const matchIndex = state.pendingMatches.findIndex(m => getMatchId(m) === mpPaymentId)
    if (matchIndex < 0) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

    const match = state.pendingMatches[matchIndex]
    const store = stores[match.order.storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const tnResult = await markOrderAsPaid(
      match.order.storeId,
      store.accessToken,
      match.order.orderId,
      { mpPaymentId: match.payment.mpPaymentId, amount: match.payment.monto }
    )

    if (!tnResult.success) {
      return NextResponse.json({ error: tnResult.error }, { status: 500 })
    }

    state.pendingMatches.splice(matchIndex, 1)

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'manual_paid',
      payment: match.payment,
      order: match.order,
      score: match.score,
      mpPaymentId: match.payment.mpPaymentId,
      amount: match.payment.monto,
      orderNumber: match.order.orderNumber,
      orderId: match.order.orderId,
      storeId: match.order.storeId,
      storeName: match.order.storeName,
      customerName: match.order.customerName,
    }
    state.matchLog.push(logEntry)

    await saveState(state)

    return NextResponse.json({ success: true, method: tnResult.method })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
