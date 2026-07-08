import { NextRequest, NextResponse } from 'next/server'
import { getStores, loadOrdersCache } from '@/lib/storage'
import { findRegistroByStoreSince } from '@/lib/registro'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import type { Order, LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { orderNumber, storeId } = await req.json()
    if (!orderNumber || !storeId) {
      return NextResponse.json({ error: 'orderNumber y storeId son requeridos' }, { status: 400 })
    }

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Búsqueda directa en la plataforma, sin límite de antigüedad (lib compartida
    // con /api/tienda/reclamar).
    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, String(orderNumber))
    } catch (err) {
      return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
    }
    if (!encontrada) return NextResponse.json({ notFound: true })
    const { order, paymentStatus, orderStatus } = encontrada

    // Verificar si ya está en el cache activo (ya está en el flujo normal)
    const ordersCache = await loadOrdersCache()
    const alreadyInCache = (ordersCache.cachedOrders || []).some(
      (o: Order) => o.orderId === order.orderId && o.storeId === order.storeId
    )

    // Buscar duplicado en el registro de los últimos 30 días (tabla registro_log),
    // acotado a la misma tienda.
    const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000
    const allRegistroEntries: LogEntry[] = await findRegistroByStoreSince(order.storeId, cutoff30d)
    const normName = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ')
    const normCuit = (s: string) => (s || '').replace(/\D/g, '')

    const orderEmail = (order.customerEmail || '').toLowerCase()
    const orderCuit = normCuit(order.customerCuit || '')
    const orderName = normName(order.customerName || '')
    const orderTotal = order.total

    let logDuplicate: { orderNumber: string; storeName: string; timestamp: string; confidence: 'alta' | 'media' } | null = null

    for (const entry of allRegistroEntries) {
      if (entry.hidden) continue
      if (entry.action !== 'auto_paid' && entry.action !== 'manual_paid') continue
      if (new Date(entry.timestamp).getTime() < cutoff30d) continue
      if (!entry.order) continue

      const entryOrder = entry.order
      if (entryOrder.storeId !== order.storeId) continue
      if (entryOrder.orderId === order.orderId) continue
      if (entryOrder.total !== orderTotal) continue

      const entryEmail = (entryOrder.customerEmail || '').toLowerCase()
      const entryCuit = normCuit(entryOrder.customerCuit || '')
      const entryName = normName(entryOrder.customerName || '')

      const emailMatch = orderEmail && entryEmail && orderEmail === entryEmail
      const cuitMatch = orderCuit.length >= 7 && entryCuit.length >= 7 && orderCuit === entryCuit

      if (emailMatch || cuitMatch) {
        logDuplicate = {
          orderNumber: entryOrder.orderNumber || entry.orderNumber || '',
          storeName: entryOrder.storeName || entry.storeName || '',
          timestamp: entry.timestamp,
          confidence: 'alta',
        }
        break
      }

      if (!logDuplicate && orderName.length > 4 && entryName === orderName) {
        logDuplicate = {
          orderNumber: entryOrder.orderNumber || entry.orderNumber || '',
          storeName: entryOrder.storeName || entry.storeName || '',
          timestamp: entry.timestamp,
          confidence: 'media',
        }
      }
    }

    return NextResponse.json({ order, paymentStatus, orderStatus, alreadyInCache, logDuplicate })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
