import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores } from '@/lib/storage'
import { cancelOrder } from '@/lib/tiendanube'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { storeId, orderId } = await req.json()
    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'storeId and orderId required' }, { status: 400 })
    }

    const [state, stores] = await Promise.all([loadState(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const ok = await cancelOrder(storeId, store.accessToken, orderId)
    if (!ok) return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'cancelled',
      orderId,
      storeId,
      storeName: store.storeName,
    }
    state.matchLog.push(logEntry)
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
