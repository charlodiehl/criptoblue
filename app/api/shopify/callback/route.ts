import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { saveStore } from '@/lib/storage'
import { CONFIG } from '@/lib/config'
import { getShopName } from '@/lib/shopify'
import { getArmedShopifyApp, clearArmedShopifyApp, normalizeShopDomain } from '@/lib/shopify-apps'
import { parseUnidad, runEnUnidad } from '@/lib/unidad'

function verifyHmac(searchParams: URLSearchParams, secret: string): boolean {
  const hmac = searchParams.get('hmac')
  if (!hmac) return false

  const parts: string[] = []
  for (const [key, value] of searchParams.entries()) {
    if (key !== 'hmac') parts.push(`${key}=${value}`)
  }
  parts.sort()

  const message = parts.join('&')
  const digest = createHmac('sha256', secret).update(message).digest('hex')
  return digest === hmac
}

export async function GET(req: NextRequest) {
  // El state viene como 'shopify:<unidad>' (lo arma /api/shopify/connect). Es la
  // única forma de saber a qué unidad de negocio va la tienda: el callback vuelve
  // sin sesión. Un state viejo ('shopify' pelado) cae en criptoblue.
  const unidad = parseUnidad((req.nextUrl.searchParams.get('state') || '').split(':')[1])
  return runEnUnidad(unidad, () => procesar(req))
}

async function procesar(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const shop = searchParams.get('shop')
  const code = searchParams.get('code')

  if (!shop || !code) {
    return NextResponse.redirect(new URL('/shopify-success?shopify_error=missing_params', req.nextUrl.origin))
  }

  // Credenciales: la app "cargada" si su dominio coincide con el que se conecta,
  // sino las de la env (compat). Al conectar con éxito con la app cargada, se libera.
  const armed = await getArmedShopifyApp()
  const useArmed = !!armed && normalizeShopDomain(armed.shop) === normalizeShopDomain(shop)
  const clientId = useArmed ? armed!.clientId : CONFIG.shopify.clientId
  const clientSecret = useArmed ? armed!.clientSecret : CONFIG.shopify.clientSecret

  if (!verifyHmac(searchParams, clientSecret)) {
    return NextResponse.redirect(new URL('/shopify-success?shopify_error=invalid_hmac', req.nextUrl.origin))
  }

  let accessToken: string
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Shopify token error:', err)
      return NextResponse.redirect(new URL('/shopify-success?shopify_error=token_failed', req.nextUrl.origin))
    }

    const tokenData = await tokenRes.json()
    accessToken = tokenData.access_token
  } catch (err) {
    console.error('Shopify token fetch error:', err)
    return NextResponse.redirect(new URL('/shopify-success?shopify_error=token_error', req.nextUrl.origin))
  }

  const shopName = await getShopName(shop, accessToken) || shop

  await saveStore({
    storeId: shop,
    storeName: shopName,
    accessToken,
    connectedAt: new Date().toISOString(),
    platform: 'shopify',
    appId: clientId,   // identifica con qué app quedó conectada
  })

  // La bala se consumió: se libera el cupo para cargar la próxima app.
  if (useArmed) {
    try { await clearArmedShopifyApp() } catch { /* best-effort: no romper la conexión ya hecha */ }
  }

  return NextResponse.redirect(
    new URL(`/shopify-success?storeId=${encodeURIComponent(shop)}`, req.nextUrl.origin)
  )
}
