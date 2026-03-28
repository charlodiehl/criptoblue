// Hard cutoffs — nada anterior a estas fechas debe aparecer
// Argentina (ART) = UTC-3

// Pagos: 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_PAYMENTS = new Date('2026-03-28T00:00:00.000Z')

// Órdenes: igual que pagos — 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_ORDERS = new Date('2026-03-28T00:00:00.000Z')

// Mapeo de fuente de pago → nombre amigable para el Registro
// Para agregar un nuevo medio de pago, solo agregar una entrada acá
export const PAYMENT_SOURCE_NAMES: Record<string, string> = {
  mercadopago: 'Mileidy',
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
