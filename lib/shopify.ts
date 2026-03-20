import { CONFIG } from './config'
import type { Order } from './types'

function shopifyHeaders(accessToken: string) {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  }
}

function apiBase(shop: string) {
  return `https://${shop}/admin/api/${CONFIG.shopify.apiVersion}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeOrder(order: any, storeId: string, storeName: string): Order {
  const customer = order.customer
  const firstName = customer?.first_name || ''
  const lastName = customer?.last_name || ''
  const customerName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    order.billing_address?.name ||
    ''

  return {
    orderId: String(order.id),
    orderNumber: order.name || String(order.order_number),
    total: parseFloat(order.total_price || '0'),
    customerName,
    customerEmail: order.email || customer?.email || '',
    customerCuit: customer?.tax_exemptions?.[0] || '',
    createdAt: order.created_at,
    gateway: order.payment_gateway || '',
    storeId,
    storeName,
  }
}

export async function getPendingOrders(
  storeId: string,
  accessToken: string,
  storeName: string,
  since: Date,
): Promise<Order[]> {
  const allOrders: Order[] = []
  const sinceISO = since.toISOString()

  let nextUrl: string | null =
    `${apiBase(storeId)}/orders.json?financial_status=pending&status=open&created_at_min=${sinceISO}&limit=250`

  while (nextUrl) {
    const currentUrl: string = nextUrl
    const res: Response = await fetch(currentUrl, { headers: shopifyHeaders(accessToken) })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Shopify API error ${res.status} for store ${storeId}: ${text}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const orders = data.orders || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allOrders.push(...orders.map((o: any) => normalizeOrder(o, storeId, storeName)))

    // Cursor-based pagination via Link header
    const linkHeader: string = res.headers.get('Link') || ''
    const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    nextUrl = nextMatch ? nextMatch[1] : null
  }

  return allOrders
}

export async function markOrderAsPaid(
  storeId: string,
  accessToken: string,
  orderId: string,
  amount: number,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBase(storeId)}/orders/${orderId}/transactions.json`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: shopifyHeaders(accessToken),
      body: JSON.stringify({
        transaction: {
          kind: 'capture',
          status: 'success',
          amount: amount.toFixed(2),
        },
      }),
    })

    if (res.ok) return { success: true }

    const errText = await res.text()
    console.error(`[shopify] markOrderAsPaid got ${res.status} for order ${orderId}:`, errText)
    return { success: false, error: `Status ${res.status}: ${errText}` }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function getShopName(storeId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase(storeId)}/shop.json`, {
      headers: shopifyHeaders(accessToken),
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    return data.shop?.name || null
  } catch {
    return null
  }
}
