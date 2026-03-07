import { NextResponse } from 'next/server'
import { getStores } from '@/lib/storage'
import { getPendingOrders } from '@/lib/tiendanube'

export async function GET() {
  try {
    const stores = await getStores()
    const storeList = Object.values(stores)

    const results = await Promise.allSettled(
      storeList.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName))
    )

    const orders = results.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      console.error(`Error fetching orders for store ${storeList[i].storeId}:`, r.reason)
      return []
    })

    return NextResponse.json(orders)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
