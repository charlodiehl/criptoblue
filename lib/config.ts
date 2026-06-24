// Hard cutoffs — nada anterior a estas fechas debe aparecer
// Argentina (ART) = UTC-3

// Pagos: 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_PAYMENTS = new Date('2026-03-28T00:00:00.000Z')

// Órdenes: igual que pagos — 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_ORDERS = new Date('2026-03-28T00:00:00.000Z')

// ─── Ventanas de tiempo (centralizadas para evitar desincronización) ──────────

// Ventana de detección de "monto duplicado": cuántas horas antes del pago
// se buscan otras órdenes con el mismo monto al computar sameMontoCount.
export const SAMEMONTO_WINDOW_HOURS = 24

// Ventana mínima del cache de órdenes (rolling desde "ahora") cuando no hay
// pagos viejos en cola. Si hay pagos sin emparejar, el cache se extiende
// automáticamente para cubrir su ventana de detección.
export const ORDER_CACHE_MIN_HOURS = 48

// Buffer extra al fetchear órdenes para cubrir la ventana de detección,
// para que órdenes creadas justo en el borde no queden fuera por segundos.
export const ORDER_CACHE_BUFFER_HOURS = 1

// Ventana del rolling de pagos en MP (cuántas horas hacia atrás se traen).
export const PAYMENT_CACHE_HOURS = 48

// Umbral de diferencia entre monto pagado y total de orden a partir del cual
// los flujos de marcado manual exigen confirmación explícita adicional.
// Aplica a manual-log (PaymentsListTab) y mark-order-paid-manual (OrdersListTab).
// El flujo de Emparejamiento manual ya muestra la diferencia visualmente.
export const MONTO_DIFF_WARNING_THRESHOLD = 5000

// Mapeo de fuente de pago → nombre amigable para el Registro
// Para agregar un nuevo medio de pago, solo agregar una entrada acá
export const PAYMENT_SOURCE_NAMES: Record<string, string> = {
  mercadopago: 'Mileidy',
  // Los pagos de Fiwind entran a la misma billetera "MF" → se muestran así.
  // El source interno sigue siendo 'fiwind' (trazabilidad del origen webhook).
  fiwind: 'MF',
}

export const CONFIG = {
  tiendanube: {
    clientId: '27051',
    clientSecret: process.env.CRIPTOBLUE_TN_CLIENT_SECRET || '',
    apiBase: 'https://api.tiendanube.com/v1',
    userAgent: 'CriptoBlue Agent (padeleroapp@gmail.com)',
  },
  mercadopago: {
    accessToken: process.env.CRIPTOBLUE_MP_ACCESS_TOKEN || '',
    apiBase: 'https://api.mercadopago.com',
  },
  shopify: {
    clientId: process.env.CRIPTOBLUE_SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.CRIPTOBLUE_SHOPIFY_CLIENT_SECRET || '',
    apiVersion: '2026-01',
    scopes: 'read_orders,write_orders,read_customers',
  },
}
