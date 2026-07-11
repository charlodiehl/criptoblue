import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { saveStore } from '@/lib/storage'
import { CONFIG } from '@/lib/config'
import { getShopName } from '@/lib/shopify'

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
  const { searchParams } = req.nextUrl
  const shop = searchParams.get('shop')
  const code = searchParams.get('code')

  if (!shop || !code) {
    return NextResponse.redirect(new URL('/shopify-success?shopify_error=missing_params', req.nextUrl.origin))
  }

  if (!verifyHmac(searchParams, CONFIG.shopify.clientSecret)) {
    return NextResponse.redirect(new URL('/shopify-success?shopify_error=invalid_hmac', req.nextUrl.origin))
  }

  let accessToken: string
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CONFIG.shopify.clientId,
        client_secret: CONFIG.shopify.clientSecret,
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
  })

  return NextResponse.redirect(
    new URL(`/shopify-success?storeId=${encodeURIComponent(shop)}`, req.nextUrl.origin)
  )
}
