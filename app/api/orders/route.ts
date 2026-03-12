import { NextResponse } from 'next/server'
import { getStores, loadState } from '@/lib/storage'
import { getPendingOrders } from '@/lib/tiendanube'

export async function GET() {
  try {
    const [stores, state] = await Promise.all([getStores(), loadState()])
    const storeList = Object.values(stores)
    const dismissed = new Set(state.dismissedOrders)

    const results = await Promise.allSettled(
      storeList.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, 48))
    )

    const orders = results.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      console.error(`Error fetching orders for store ${storeList[i].storeId}:`, r.reason)
      return []
    }).filter(o => !dismissed.has(o.orderId))

    return NextResponse.json(orders)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
