import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { getShopifyCredsForShop } from '@/lib/shopify-apps'

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop')
  if (!shop) {
    return NextResponse.json({ error: 'shop parameter required' }, { status: 400 })
  }
  // Normalize: accept "mitienda" or "mitienda.myshopify.com"
  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`

  const redirectUri = `${req.nextUrl.origin}/api/shopify/callback`

  // Credenciales de la app cargada para este dominio (o la env como fallback).
  const { clientId } = await getShopifyCredsForShop(shopDomain)

  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', CONFIG.shopify.scopes)
  url.searchParams.set('redirect_uri', redirectUri)
  // Las tiendas ya no se vinculan a una billetera: state mínimo (anti-CSRF).
  url.searchParams.set('state', 'shopify')

  return NextResponse.redirect(url.toString())
}
