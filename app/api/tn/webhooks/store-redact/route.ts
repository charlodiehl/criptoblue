import { NextRequest } from 'next/server'
import { manejarWebhookPrivacidad } from '@/lib/tn-webhooks'

// Webhook de privacidad de Tiendanube: la tienda desinstaló la app (48hs después).
export async function POST(req: NextRequest) {
  return manejarWebhookPrivacidad(req, 'store/redact')
}
