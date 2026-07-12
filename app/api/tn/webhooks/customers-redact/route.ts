import { NextRequest } from 'next/server'
import { manejarWebhookPrivacidad } from '@/lib/tn-webhooks'

// Webhook de privacidad de Tiendanube: un cliente pidió que borren sus datos.
export async function POST(req: NextRequest) {
  return manejarWebhookPrivacidad(req, 'customers/redact')
}
