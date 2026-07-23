import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { getShopifyCredsForShop } from '@/lib/shopify-apps'
import { parseUnidad, runEnUnidad } from '@/lib/unidad'

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop')
  if (!shop) {
    return NextResponse.json({ error: 'shop parameter required' }, { status: 400 })
  }
  // Normalize: accept "mitienda" or "mitienda.myshopify.com"
  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`

  const redirectUri = `${req.nextUrl.origin}/api/shopify/callback`

  // Unidad de negocio de la tienda que se conecta. La app "cargada" también es por
  // unidad, así que se resuelve dentro de su contexto. Sin parámetro → criptoblue.
  const unidad = parseUnidad(req.nextUrl.searchParams.get('unidad'))

  // Credenciales de la app cargada para este dominio (o la env como fallback).
  const { clientId } = await runEnUnidad(unidad, () => getShopifyCredsForShop(shopDomain))

  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', CONFIG.shopify.scopes)
  url.searchParams.set('redirect_uri', redirectUri)
  // Las tiendas ya no se vinculan a una billetera. El state lleva la unidad, que es
  // lo único que el callback (que vuelve sin sesión) no podría averiguar solo.
  url.searchParams.set('state', `shopify:${unidad}`)

  return NextResponse.redirect(url.toString())
}
