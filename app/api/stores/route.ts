import { NextRequest, NextResponse } from 'next/server'
import { getStores, saveStores, loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, loadOrdersCache, saveOrdersCache } from '@/lib/storage'

// Auth manejada por middleware.ts — GET público, PATCH/DELETE requieren sesión

export async function GET() {
  try {
    const stores = await getStores()
    return NextResponse.json(Object.values(stores))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { storeId, storeName, walletId } = await req.json()
    if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })
    if (storeName === undefined && walletId === undefined) {
      return NextResponse.json({ error: 'storeName or walletId required' }, { status: 400 })
    }

    const stores = await getStores()
    if (!stores[storeId]) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    if (storeName !== undefined) stores[storeId].storeName = storeName
    if (walletId !== undefined) stores[storeId].walletId = walletId || undefined
    await saveStores(stores)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { storeId } = await req.json()
    if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

    const stores = await getStores()
    if (!stores[storeId]) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const storeName = stores[storeId].storeName
    delete stores[storeId]

    // Limpiar registros asociados a la tienda usando cargas parciales
    const [hot, logs, ordersCache] = await Promise.all([loadHotState(), loadLogs(), loadOrdersCache()])

    // UnmatchedPayment no tiene storeId directo — filtrar por storeName (#A1)
    hot.unmatchedPayments = hot.unmatchedPayments.filter(u => u.storeName !== storeName)

    // Limpiar recentMatches de la tienda
    hot.recentMatches = (hot.recentMatches ?? []).filter(m => m.storeId !== storeId)

    // Limpiar dismissedPairs de la tienda
    hot.dismissedPairs = (hot.dismissedPairs ?? []).filter(d => d.storeId !== storeId)

    // Eliminar las órdenes pendientes de la tienda del caché.
    // NO se toca registro_log: lo que ya se cobró queda en el historial.
    ordersCache.cachedOrders = (ordersCache.cachedOrders ?? []).filter(o => o.storeId !== storeId)

    appendActivity(logs, 'human', 'tienda_eliminada', { storeId, storeName })

    await Promise.all([saveStores(stores), saveHotState(hot), saveLogs(logs), saveOrdersCache(ordersCache)])

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
