import { CONFIG } from './config'
import type { Order } from './types'

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': CONFIG.tiendanube.userAgent,
    'Content-Type': 'application/json',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeOrder(order: any, storeId: string, storeName: string): Order {
  return {
    orderId: String(order.id),
    orderNumber: String(order.number),
    total: parseFloat(order.total),
    customerName: order.contact_name || order.billing_name || order.customer?.name || '',
    customerEmail: order.contact_email || order.customer?.email || '',
    customerCuit: order.contact_identification || order.customer?.identification || '',
    createdAt: order.created_at,
    gateway: order.gateway_name || order.gateway || '',
    storeId,
    storeName,
  }
}

export async function getPendingOrders(storeId: string, accessToken: string, storeName: string, since: Date): Promise<Order[]> {
  const allOrders: Order[] = []
  let page = 1

  const sinceISO = since.toISOString()

  while (true) {
    const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?payment_status=pending&per_page=200&page=${page}&created_at_min=${sinceISO}`
    const res = await fetch(url, { headers: tnHeaders(accessToken) })

    if (!res.ok) {
      const text = await res.text()
      if (res.status === 404 && text.includes('Last page is 0')) break
      throw new Error(`TN API error ${res.status} for store ${storeId}: ${text}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = await res.json()
    if (!orders.length) break

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allOrders.push(...orders.map((o: any) => normalizeOrder(o, storeId, storeName)))

    if (orders.length < 200) break
    page++
  }

  return allOrders
}

export async function markOrderAsPaid(
  storeId: string,
  accessToken: string,
  orderId: string,
): Promise<{ success: boolean; method: 'status' | 'note'; error?: string }> {
  const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders/${orderId}`

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: tnHeaders(accessToken),
      body: JSON.stringify({ status: 'paid' }),
    })

    if (res.ok) {
      const body = await res.json().catch(() => null)
      const actualStatus = body?.status
      const gateway = body?.gateway_name || body?.gateway
      console.log('[tiendanube] markOrderAsPaid PUT 200 → status:', actualStatus, '| gateway:', gateway, '| order:', orderId)
      return { success: true, method: 'status' }
    }

    const errText = await res.text()
    console.error(`[tiendanube] markOrderAsPaid got ${res.status} for order ${orderId}:`, errText)
    return { success: false, method: 'status', error: `Status ${res.status}: ${errText}` }
  } catch (err) {
    return { success: false, method: 'status', error: String(err) }
  }
}

