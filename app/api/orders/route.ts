import { NextResponse } from 'next/server'
import { getStores, loadState } from '@/lib/storage'
import { getPendingOrders } from '@/lib/tiendanube'

// Nunca traer órdenes anteriores a esta fecha (13/03/2026 20:00 ART)
const HARD_CUTOFF = new Date('2026-03-13T23:00:00.000Z')

export async function GET() {
  try {
    const [stores, state] = await Promise.all([getStores(), loadState()])
    const storeList = Object.values(stores)
    const dismissed = new Set(state.dismissedOrders)

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
    }).filter(o => !dismissed.has(o.orderId))

    return NextResponse.json(orders)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
