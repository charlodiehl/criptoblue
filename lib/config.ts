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
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2.5',
  },
}
