import { NextResponse } from 'next/server'
import { getStores } from '@/lib/storage'
import { getPendingOrders } from '@/lib/tiendanube'
import { HARD_CUTOFF } from '@/lib/config'

export async function GET() {
  try {
    const [stores] = await Promise.all([getStores()])
    const storeList = Object.values(stores)

    // Calcular horas desde el cutoff efectivo (máximo entre rolling 48h y hard cutoff)
    const sinceMs = Math.max(Date.now() - 48 * 3600000, HARD_CUTOFF.getTime())
    const sinceHours = (Date.now() - sinceMs) / 3600000

    const results = await Promise.allSettled(
      storeList.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, sinceHours))
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
