import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop')
  if (!shop) {
    return NextResponse.json({ error: 'shop parameter required' }, { status: 400 })
  }

  // Normalize: accept "mitienda" or "mitienda.myshopify.com"
  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`

  const redirectUri = `${req.nextUrl.origin}/api/shopify/callback`

  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`)
  url.searchParams.set('client_id', CONFIG.shopify.clientId)
  url.searchParams.set('scope', CONFIG.shopify.scopes)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', shopDomain)

  return NextResponse.redirect(url.toString())
}
