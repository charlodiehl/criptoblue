import { CONFIG } from './config'
import type { Order, Store } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda de UNA orden por número directo en la plataforma (TiendaNube/Shopify),
// SIN límite de antigüedad (no depende del cache rolling de 48hs).
// Usada por /api/buscar-orden (modal del admin) y /api/tienda/reclamar (portal).
// ─────────────────────────────────────────────────────────────────────────────

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
export function normalizeTNOrder(raw: any, storeId: string, storeName: string): Order {
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
export function normalizeShopifyOrder(raw: any, storeId: string, storeName: string): Order {
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

export interface OrdenEncontrada {
  order: Order
  paymentStatus: string  // TN: payment_status · Shopify: financial_status
  orderStatus: string
}

// Busca la orden por número exacto en la plataforma de la tienda.
// null = no existe. Lanza error si la API de la plataforma falla.
export async function buscarOrdenEnTienda(store: Store, orderNumber: string): Promise<OrdenEncontrada | null> {
  const platform = store.platform ?? 'tiendanube'
  const storeId = store.storeId

  if (platform === 'tiendanube') {
    const url = `${CONFIG.tiendanube.apiBase}/${storeId}/orders?q=${encodeURIComponent(orderNumber)}&per_page=50`
    const res = await fetch(url, { headers: tnHeaders(store.accessToken) })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Error al consultar TiendaNube: ${res.status} ${text}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = Array.isArray(data) ? data.find((o: any) => String(o.number) === String(orderNumber)) : null
    if (!raw) return null
    return {
      order: normalizeTNOrder(raw, storeId, store.storeName),
      paymentStatus: raw.payment_status || '',
      orderStatus: raw.status || '',
    }
  }

  // Shopify: buscar por name (#XXXX) con status=any
  const nameParam = encodeURIComponent(`#${orderNumber}`)
  const url = `https://${storeId}/admin/api/${CONFIG.shopify.apiVersion}/orders.json?name=${nameParam}&status=any&limit=5`
  const res = await fetch(url, { headers: shopifyHeaders(store.accessToken) })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error al consultar Shopify: ${res.status} ${text}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  const orders = data.orders || []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = orders.find((o: any) => (o.name || '').replace(/^#/, '') === String(orderNumber))
  if (!raw) return null
  return {
    order: normalizeShopifyOrder(raw, storeId, store.storeName),
    paymentStatus: raw.financial_status || '',
    orderStatus: raw.status || '',
  }
}
