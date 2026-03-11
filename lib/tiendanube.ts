import { CONFIG } from './config'
import type { Order } from './types'

const OFFLINE_GATEWAYS = ['offline', 'convenir', 'transferencia', 'wire', 'bank', 'deposito', 'depósito', 'efectivo']

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': CONFIG.tiendanube.userAgent,
    'Content-Type': 'application/json',
  }
}

function isOfflineGateway(gateway: string): boolean {
  const lower = gateway.toLowerCase()
  return OFFLINE_GATEWAYS.some(g => lower.includes(g))
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

export async function getPendingOrders(storeId: string, accessToken: string, storeName: string): Promise<Order[]> {
  const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?payment_status=pending&per_page=200`
  const res = await fetch(url, { headers: tnHeaders(accessToken) })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`TN API error ${res.status} for store ${storeId}: ${text}`)
  }

  const orders = await res.json()

  return orders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((o: any) => isOfflineGateway(o.gateway_name || o.gateway || ''))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((o: any) => normalizeOrder(o, storeId, storeName))
}

export async function markOrderAsPaid(
  storeId: string,
  accessToken: string,
  orderId: string,
  paymentData?: { mpPaymentId?: string; amount?: number }
): Promise<{ success: boolean; method: 'status' | 'note'; error?: string }> {
  const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders/${orderId}`

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: tnHeaders(accessToken),
      body: JSON.stringify({ payment_status: 'paid' }),
    })

    if (res.ok) {
      const body = await res.json().catch(() => null)
      const actualStatus = body?.payment_status
      const gateway = body?.gateway_name || body?.gateway
      console.log('[tiendanube] markOrderAsPaid PUT 200 → payment_status:', actualStatus, '| gateway:', gateway, '| order:', orderId)

      if (actualStatus && actualStatus !== 'paid') {
        // TN returned 200 but silently ignored the payment_status field — add a note as fallback
        console.warn('[tiendanube] TN ignored payment_status change (still:', actualStatus, ') for gateway:', gateway, '— falling back to note')
        const note = paymentData
          ? `PAGO CONFIRMADO - MP ID: ${paymentData.mpPaymentId || 'N/A'} | Monto: $${paymentData.amount || 'N/A'} | Marcado manualmente via CriptoBlue`
          : 'PAGO CONFIRMADO por CriptoBlue'
        const noteRes = await fetch(url, {
          method: 'PUT',
          headers: tnHeaders(accessToken),
          body: JSON.stringify({ owner_note: note }),
        })
        if (noteRes.ok) {
          return { success: true, method: 'note' }
        }
      }
      return { success: true, method: 'status' }
    }

    if (res.status === 403 || res.status === 422) {
      const errBody = await res.text()
      console.error(`[tiendanube] markOrderAsPaid got ${res.status} for order ${orderId}:`, errBody)
      const note = paymentData
        ? `PAGO CONFIRMADO - MP ID: ${paymentData.mpPaymentId || 'N/A'} | Monto: $${paymentData.amount || 'N/A'} | Marcado manualmente via CriptoBlue`
        : 'PAGO CONFIRMADO por CriptoBlue'

      const fallbackRes = await fetch(url, {
        method: 'PUT',
        headers: tnHeaders(accessToken),
        body: JSON.stringify({ owner_note: note }),
      })

      if (fallbackRes.ok) {
        return { success: true, method: 'note' }
      }

      const errText = await fallbackRes.text()
      return { success: false, method: 'note', error: `Fallback failed: ${errText}` }
    }

    const errText = await res.text()
    return { success: false, method: 'status', error: `Status ${res.status}: ${errText}` }
  } catch (err) {
    return { success: false, method: 'status', error: String(err) }
  }
}

export async function cancelOrder(storeId: string, accessToken: string, orderId: string): Promise<boolean> {
  const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders/${orderId}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: tnHeaders(accessToken),
    body: JSON.stringify({ status: 'cancelled' }),
  })
  return res.ok
}
