// Hard cutoffs — nada anterior a estas fechas debe aparecer
// Argentina (ART) = UTC-3

// Pagos: 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_PAYMENTS = new Date('2026-03-28T00:00:00.000Z')

// Órdenes: igual que pagos — 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_ORDERS = new Date('2026-03-28T00:00:00.000Z')

// Fecha de corte del BALANCE por tienda: solo las órdenes registradas desde este
// momento generan movimiento de ingreso (balance_movements). Lo anterior se
// representa con el saldo inicial por tienda (scripts/cargar-saldo-inicial.mjs).
// 8/7/2026 00:00 ART.
export const BALANCE_CUTOFF = new Date('2026-07-08T00:00:00-03:00')

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
  // Los pagos cargados desde planilla Excel son de la billetera "Lacar".
  lacar: 'Lacar',
  // Los pagos que manda directo el sistema de "Notificador" (webhook a webhook)
  // son de la billetera "MS".
  notificador: 'MS',
  // Los pagos de Montemar pay entran por email (Apps Script → webhook, igual que
  // Fiwind) a la billetera "Montemar".
  montemar: 'Montemar',
}

// Billeteras disponibles para asignarle a una tienda (desplegable al conectar).
// Para agregar una billetera nueva: sumarla acá y mapear sus fuentes de pago en
// PAYMENT_SOURCE_TO_WALLET.
export const WALLETS = ['MF', 'Lacar', 'MS', 'Montemar'] as const

// Mapeo de fuente de pago (payment.source) → billetera a la que pertenece.
// Usado para acotar el emparejamiento: un pago solo busca candidatas entre
// tiendas de su misma billetera (ver lib/auto-match.ts).
export const PAYMENT_SOURCE_TO_WALLET: Record<string, string> = {
  mercadopago: 'MF',
  fiwind: 'MF',
  lacar: 'Lacar',
  notificador: 'MS',
  montemar: 'Montemar',
}

// Billeteras cuyos pagos sin emparejar NUNCA vencen: no se purgan de la cola ni
// desaparecen de la vista por antigüedad (ignoran el rolling de 48hs), mientras
// sigan sin emparejar y sin marcar "No es de tiendas". Al emparejarse o marcarse,
// vuelven al comportamiento normal de expiración a las 48hs.
export const WALLETS_SIN_VENCIMIENTO: readonly string[] = ['MF', 'Lacar', 'MS', 'Montemar']

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
