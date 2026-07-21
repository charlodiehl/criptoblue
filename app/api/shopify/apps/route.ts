import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import {
  getArmedShopifyApp, setArmedShopifyApp, clearArmedShopifyApp, normalizeShopDomain,
  type ArmedShopifyApp,
} from '@/lib/shopify-apps'

// Vista pública: NUNCA se devuelve el client_secret al cliente.
function publicView(app: ArmedShopifyApp | null) {
  if (!app) return null
  return { clientId: app.clientId, shop: app.shop, label: app.label, armedAt: app.armedAt }
}

// GET → { armed: {...sin secret} | null }
export async function GET() {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ armed: publicView(await getArmedShopifyApp()) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST { shop, clientId, clientSecret, label? } → carga la "bala".
// Rechaza si ya hay una app armada (un solo tiro a la vez).
export async function POST(req: NextRequest) {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error
  try {
    if (await getArmedShopifyApp()) {
      return NextResponse.json(
        { error: 'Ya hay una app cargada. Esperá a que se conecte una tienda con ella o descartala.' },
        { status: 409 },
      )
    }
    const body = await req.json().catch(() => null)
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : ''
    const shop = normalizeShopDomain(typeof body?.shop === 'string' ? body.shop : '')
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!clientId || !clientSecret || !shop) {
      return NextResponse.json(
        { error: 'Faltan datos: dominio de la tienda, Client ID y Client secret son obligatorios.' },
        { status: 400 },
      )
    }
    const armed = await setArmedShopifyApp({ clientId, clientSecret, shop, label: label || shop })
    return NextResponse.json({ armed: publicView(armed) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE → descarta la app cargada (por si se cargó con un error).
export async function DELETE() {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error
  try {
    await clearArmedShopifyApp()
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
