// Fecha de reset — nada anterior a este momento debe aparecer en ningún lado
// 17/03/2026 12:42 hs Argentina (ART = UTC-3) → 15:42 UTC
export const HARD_CUTOFF = new Date('2026-03-17T15:42:00.000Z')

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
  matching: {
    autoThreshold: 90,
    reviewThreshold: 60,
    amountTolerancePct: 1,
    timingWindowHours: 48,
  },

}
