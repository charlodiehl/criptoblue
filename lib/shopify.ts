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

// Busca el CUIT/DNI del cliente en todos los campos donde Shopify Argentina suele guardarlo
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCuit(order: any): string {
  // 1. billing_address.company — campo más común en tiendas AR (ej: "24632075" o "20-24632075-3")
  const fromCompany = order.billing_address?.company?.trim()
  if (fromCompany && /^\d{7,11}$/.test(fromCompany.replace(/[-\s]/g, ''))) {
    return fromCompany
  }

  // 2. note_attributes — algunas apps/checkouts lo guardan como atributo de la orden
  const noteAttrs: { name: string; value: string }[] = order.note_attributes || []
  const cuitAttr = noteAttrs.find(a =>
    /cuit|cuil|dni|documento|nro_doc|numero_doc|identification/i.test(a.name)
  )
  if (cuitAttr?.value?.trim()) return cuitAttr.value.trim()

  // 3. customer.note — algunos admins lo cargan manualmente en la ficha del cliente
  const customerNote = order.customer?.note?.trim()
  if (customerNote) {
    const match = customerNote.match(/\b\d{7,11}\b/)
    if (match) return match[0]
  }

  // 4. order.note — nota libre de la orden
  const orderNote = order.note?.trim()
  if (orderNote) {
    const match = orderNote.match(/\b\d{7,11}\b/)
    if (match) return match[0]
  }

  return ''
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
    orderNumber: (order.name || String(order.order_number)).replace(/^#/, ''),
    total: parseFloat(order.total_price || '0'),
    customerName,
    customerEmail: order.email || customer?.email || '',
    customerCuit: extractCuit(order),
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

  // status=any (no status=open): algunas tiendas archivan sus órdenes aunque el
  // pago siga pendiente (ej. Alvia archiva en lote), y archivar en Shopify pone
  // status=closed. Con status=open esas quedaban invisibles y no se podían
  // conciliar. Las canceladas sí se descartan abajo (no son cobrables).
  let nextUrl: string | null =
    `${apiBase(storeId)}/orders.json?financial_status=pending&status=any&created_at_min=${sinceISO}&limit=250`

  while (nextUrl) {
    const currentUrl: string = nextUrl
    const res: Response = await fetch(currentUrl, { headers: shopifyHeaders(accessToken) })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Shopify API error ${res.status} for store ${storeId}: ${text}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    // Excluir órdenes canceladas: siguen pudiendo figurar como pending pero no se cobran.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = (data.orders || []).filter((o: any) => !o.cancelled_at)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allOrders.push(...orders.map((o: any) => normalizeOrder(o, storeId, storeName)))

    // Cursor-based pagination via Link header
    const linkHeader: string = res.headers.get('Link') || ''
    const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    nextUrl = nextMatch ? nextMatch[1] : null
  }

  return allOrders
}

// Marca una orden de Shopify como pagada usando la mutation GraphQL orderMarkAsPaid.
// Shopify decide internamente si crear un 'sale' nuevo (pago manual / transferencia)
// o capturar una autorización existente, según el estado de pago de la orden.
// Esto evita el error "Parent transaction should be a successful authorization" que
// ocurría al intentar capturar manualmente una transacción 'sale' pendiente.
// El parámetro `amount` se mantiene por compatibilidad de firma con TiendaNube; la
// mutation marca el total pendiente completo, así que no se usa.
export async function markOrderAsPaid(
  storeId: string,
  accessToken: string,
  orderId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  amount: number,
): Promise<{ success: boolean; error?: string }> {
  const gqlUrl = `${apiBase(storeId)}/graphql.json`
  const mutation = `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      userErrors { field message }
      order { id displayFinancialStatus }
    }
  }`
  const variables = { input: { id: `gid://shopify/Order/${orderId}` } }

  try {
    const res = await fetch(gqlUrl, {
      method: 'POST',
      headers: shopifyHeaders(accessToken),
      body: JSON.stringify({ query: mutation, variables }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[shopify] orderMarkAsPaid HTTP ${res.status} for order ${orderId}:`, errText)
      return { success: false, error: `Status ${res.status}: ${errText}` }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()

    // Errores de nivel GraphQL (sintaxis, permisos, throttling)
    if (data.errors?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = data.errors.map((e: any) => e.message).join('; ')
      console.error(`[shopify] orderMarkAsPaid GraphQL errors for order ${orderId}:`, msg)
      return { success: false, error: `GraphQL: ${msg}` }
    }

    // userErrors de la mutation (ej: orden en estado que no permite marcar pagada)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userErrors: any[] = data.data?.orderMarkAsPaid?.userErrors ?? []
    if (userErrors.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = userErrors.map((e: any) => `${(e.field || []).join('.')}: ${e.message}`).join('; ')
      console.error(`[shopify] orderMarkAsPaid userErrors for order ${orderId}:`, msg)
      return { success: false, error: msg }
    }

    const status = data.data?.orderMarkAsPaid?.order?.displayFinancialStatus
    console.log(`[shopify] orderMarkAsPaid OK order=${orderId} status=${status}`)
    return { success: true }
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
