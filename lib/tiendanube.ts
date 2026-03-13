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

export async function getPendingOrders(storeId: string, accessToken: string, storeName: string, sinceHours = 48): Promise<Order[]> {
  const allOrders: Order[] = []
  let page = 1

  // Solo órdenes dentro del rango de horas solicitado (default 48h)
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()

  while (true) {
    const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?payment_status=pending&per_page=200&page=${page}&created_at_min=${since}`
    const res = await fetch(url, { headers: tnHeaders(accessToken) })

    if (!res.ok) {
      const text = await res.text()
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

export async function cancelOrder(storeId: string, accessToken: string, orderId: string, note?: string): Promise<boolean> {
  const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders/${orderId}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: tnHeaders(accessToken),
    body: JSON.stringify({ status: 'cancelled' }),
  })
  if (!res.ok) return false

  if (note) {
    await fetch(url, {
      method: 'PUT',
      headers: tnHeaders(accessToken),
      body: JSON.stringify({ owner_note: note }),
    })
  }

  return true
}

/**
 * Cancela en TiendaNube todas las órdenes con payment_status=pending
 * que tengan más de 48h (consideradas abandonadas).
 * Busca hasta 15 días atrás para no traer historial excesivo.
 */
export async function cancelAbandonedOrders(
  storeId: string,
  accessToken: string,
): Promise<{ cancelled: number; errors: number }> {
  const result = { cancelled: 0, errors: 0 }
  const now = Date.now()
  const cutoff48h = new Date(now - 48 * 60 * 60 * 1000).toISOString()
  const cutoff72h = new Date(now - 72 * 60 * 60 * 1000).toISOString()

  let page = 1
  while (true) {
    const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?payment_status=pending&per_page=200&page=${page}&created_at_min=${cutoff72h}&created_at_max=${cutoff48h}`
    const res = await fetch(url, { headers: tnHeaders(accessToken) })
    if (!res.ok) break

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = await res.json()
    if (!orders.length) break

    for (const order of orders) {
      const ok = await cancelOrder(storeId, accessToken, String(order.id), 'Orden cancelada automáticamente por proceso de Criptoblue')
      if (ok) result.cancelled++
      else result.errors++
    }

    if (orders.length < 200) break
    page++
  }

  return result
}
