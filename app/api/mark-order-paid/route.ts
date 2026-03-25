import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, incrementPersistedMonthStats } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { storeId, orderId, total } = await req.json()
    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'storeId and orderId required' }, { status: 400 })
    }

    const [state, stores] = await Promise.all([loadState(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const platform = store.platform ?? 'tiendanube'

    let success: boolean
    let error: string | undefined

    if (platform === 'shopify') {
      if (!total && total !== 0) {
        return NextResponse.json({ error: 'total required for Shopify orders' }, { status: 400 })
      }
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, orderId, total)
      success = result.success
      error = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, orderId)
      success = result.success
      error = result.error
    }

    if (!success) {
      return NextResponse.json({ error }, { status: 500 })
    }

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'manual_paid',
      source: 'manual_ordenes',
      triggeredBy: 'human',
      orderId,
      storeId,
      storeName: store.storeName,
      amount: total || undefined,
    }
    state.registroLog.push(logEntry)
    state.matchLog.push(logEntry)
    if (total) incrementPersistedMonthStats(state, total, 'manual_ordenes')
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
