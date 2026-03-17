import { NextRequest, NextResponse } from 'next/server'
import { saveStore } from '@/lib/storage'
import { CONFIG } from '@/lib/config'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  // "state" contiene el nombre de la tienda ingresado por el usuario antes del OAuth
  const stateParam = searchParams.get('state') || ''

  if (!code) {
    return NextResponse.redirect(new URL('/tn-success?tn_error=no_code', req.nextUrl.origin))
  }

  const clientSecret = CONFIG.tiendanube.clientSecret
  if (!clientSecret) {
    return NextResponse.redirect(new URL('/tn-success?tn_error=no_secret', req.nextUrl.origin))
  }

  // Intercambiar code por access_token
  let accessToken: string
  let storeId: string
  try {
    const tokenRes = await fetch('https://www.tiendanube.com/apps/authorize/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.tiendanube.clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('TN token error:', err)
      return NextResponse.redirect(new URL('/tn-success?tn_error=token_failed', req.nextUrl.origin))
    }

    const tokenData = await tokenRes.json()
    accessToken = tokenData.access_token
    storeId = String(tokenData.user_id)
  } catch (err) {
    console.error('TN token fetch error:', err)
    return NextResponse.redirect(new URL('/tn-success?tn_error=token_error', req.nextUrl.origin))
  }

  // Nombre de la tienda: prioridad al ingresado manualmente por el usuario (state param)
  // Si no vino en el state, intentar obtenerlo de la API de TiendaNube como fallback
  let storeName = stateParam.trim() || `Tienda ${storeId}`

  if (!stateParam.trim()) {
    try {
      const storeRes = await fetch(`${CONFIG.tiendanube.apiBase}/${storeId}`, {
        headers: {
          Authentication: `bearer ${accessToken}`,
          'User-Agent': CONFIG.tiendanube.userAgent,
        },
      })
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        const name = storeData.name
        if (typeof name === 'string' && name) {
          storeName = name
        } else if (name && typeof name === 'object') {
          storeName = name.es || name.pt || Object.values(name).find((v): v is string => typeof v === 'string') || storeName
        }
      }
    } catch {
      // usar nombre por defecto
    }
  }

  // Guardar en Supabase
  await saveStore({
    storeId,
    storeName,
    accessToken,
    connectedAt: new Date().toISOString(),
  })

  return NextResponse.redirect(new URL('/tn-success', req.nextUrl.origin))
}
