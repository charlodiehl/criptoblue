import { NextRequest, NextResponse } from 'next/server'
import { getStores, loadOrdersCache } from '@/lib/storage'
import { CONFIG } from '@/lib/config'
import type { Order } from '@/lib/types'

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': CONFIG.tiendanube.userAgent,
    'Content-Type': 'application/json',
  }
}

function shopifyHeaders(accessToken: string) {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTNOrder(raw: any, storeId: string, storeName: string): Order {
  return {
    orderId: String(raw.id),
    orderNumber: String(raw.number),
    total: parseFloat(raw.total),
    customerName: raw.contact_name || raw.billing_name || raw.customer?.name || '',
    customerEmail: raw.contact_email || raw.customer?.email || '',
    customerCuit: raw.contact_identification || raw.customer?.identification || '',
    createdAt: raw.created_at,
    gateway: raw.gateway_name || raw.gateway || '',
    storeId,
    storeName,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeShopifyOrder(raw: any, storeId: string, storeName: string): Order {
  const customer = raw.customer
  const firstName = customer?.first_name || ''
  const lastName = customer?.last_name || ''
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || raw.billing_address?.name || ''
  return {
    orderId: String(raw.id),
    orderNumber: (raw.name || String(raw.order_number)).replace(/^#/, ''),
    total: parseFloat(raw.total_price || '0'),
    customerName,
    customerEmail: raw.email || customer?.email || '',
    customerCuit: '',
    createdAt: raw.created_at,
    gateway: raw.payment_gateway || '',
    storeId,
    storeName,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orderNumber, storeId } = await req.json()
    if (!orderNumber || !storeId) {
      return NextResponse.json({ error: 'orderNumber y storeId son requeridos' }, { status: 400 })
    }

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    const platform = store.platform ?? 'tiendanube'
    let order: Order | null = null
    let paymentStatus = ''
    let orderStatus = ''

    if (platform === 'tiendanube') {
      const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?q=${encodeURIComponent(orderNumber)}&per_page=50`
      const res = await fetch(url, { headers: tnHeaders(store.accessToken) })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: `Error al consultar TiendaNube: ${res.status} ${text}` }, { status: 500 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = await res.json()
      const raw = Array.isArray(data) ? data.find((o: any) => String(o.number) === String(orderNumber)) : null
      if (!raw) return NextResponse.json({ notFound: true })
      order = normalizeTNOrder(raw, storeId, store.storeName)
      paymentStatus = raw.payment_status || ''
      orderStatus = raw.status || ''
    } else {
      // Shopify: buscar por name (#XXXX) con status=any
      const nameParam = encodeURIComponent(`#${orderNumber}`)
      const url = `https://${storeId}/admin/api/${CONFIG.shopify.apiVersion}/orders.json?name=${nameParam}&status=any&limit=5`
      const res = await fetch(url, { headers: shopifyHeaders(store.accessToken) })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: `Error al consultar Shopify: ${res.status} ${text}` }, { status: 500 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()
      const orders = data.orders || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = orders.find((o: any) => (o.name || '').replace(/^#/, '') === String(orderNumber))
      if (!raw) return NextResponse.json({ notFound: true })
      order = normalizeShopifyOrder(raw, storeId, store.storeName)
      paymentStatus = raw.financial_status || ''
      orderStatus = raw.status || ''
    }

    // Verificar si ya está en el cache activo (ya está en el flujo normal)
    const ordersCache = await loadOrdersCache()
    const alreadyInCache = (ordersCache.cachedOrders || []).some(
      (o: Order) => o.orderId === order!.orderId && o.storeId === order!.storeId
    )

    return NextResponse.json({ order, paymentStatus, orderStatus, alreadyInCache })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
