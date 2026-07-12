import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { CONFIG } from './config'

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks OBLIGATORIOS de privacidad que exige Tiendanube (LGPD/GDPR):
//   store/redact           → 48hs después de que una tienda desinstala la app.
//   customers/redact       → un cliente pidió que borren sus datos.
//   customers/data_request → un cliente pidió una copia de sus datos.
//
// Tiendanube firma el body con HMAC-SHA256 (base64) usando el client_secret de la
// app, en el header x-linkedstore-hmac-sha256.
//
// Por ahora estos handlers solo ACUSAN recibo (200) y registran el evento: los
// datos que maneja la app son financieros (conciliación de pagos) y su borrado se
// decide a mano, no en automático. IMPORTANTE: antes de agregar cualquier acción
// destructiva (borrar/scrubear datos), exigir que la firma sea válida.
// ─────────────────────────────────────────────────────────────────────────────

function firmaValida(rawBody: string, header: string | null): boolean {
  const secret = CONFIG.tiendanube.clientSecret
  if (!secret || !header) return false
  const esperado = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  const a = Buffer.from(header)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function manejarWebhookPrivacidad(req: NextRequest, tipo: string): Promise<NextResponse> {
  const raw = await req.text()
  const valida = firmaValida(raw, req.headers.get('x-linkedstore-hmac-sha256'))
  let storeId = ''
  try { storeId = String(JSON.parse(raw || '{}')?.store_id ?? '') } catch { /* body no-JSON */ }
  console.log(`[tn-webhook] ${tipo} · store ${storeId || '—'} · firma ${valida ? 'ok' : 'inválida'}`)
  // Handler inerte → se acusa recibo siempre, así Tiendanube no marca el endpoint
  // como caído ni reintenta. No se ejecuta ninguna acción sobre los datos.
  return NextResponse.json({ ok: true })
}
