import { NextResponse } from 'next/server'
import { loadState, saveState, getStores } from '@/lib/storage'
import { getPendingOrders } from '@/lib/tiendanube'
import { HARD_CUTOFF } from '@/lib/config'

export async function GET() {
  try {
    const state = await loadState()

    // Si hay cache válido, devolverlo directamente — todos los clientes ven lo mismo
    if (state.cachedOrders && state.cachedOrders.length > 0) {
      return NextResponse.json(state.cachedOrders)
    }

    // Fallback: cache vacío (primer arranque o reset) → fetch directo a TiendaNube y guardar cache
    const stores = await getStores()
    const storeList = Object.values(stores)

    const since = new Date(Math.max(Date.now() - 48 * 3600000, HARD_CUTOFF.getTime()))

    const results = await Promise.allSettled(
      storeList.map(s => getPendingOrders(s.storeId, s.accessToken, s.storeName, since))
    )

    const orders = results.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      console.error(`Error fetching orders for store ${storeList[i].storeId}:`, r.reason)
      return []
    })

    // Guardar en cache para los próximos clientes
    if (results.some(r => r.status === 'fulfilled')) {
      state.cachedOrders = orders
      state.cachedOrdersAt = new Date().toISOString()
      await saveState(state)
    }

    return NextResponse.json(orders)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
