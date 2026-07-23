import { NextRequest, NextResponse } from 'next/server'
import { saveStore } from '@/lib/storage'
import { CONFIG } from '@/lib/config'
import { parseUnidad, runEnUnidad, type UnidadId } from '@/lib/unidad'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state') || ''

  // "state" empaqueta { name, unidad } elegidos antes del OAuth (JSON). Si no es
  // JSON válido, es un state legacy: el texto plano ES el nombre.
  let stateName = ''
  let unidad: UnidadId = parseUnidad(null)   // default: criptoblue
  if (stateParam) {
    try {
      const parsed = JSON.parse(stateParam)
      stateName = typeof parsed.name === 'string' ? parsed.name : ''
      unidad = parseUnidad(parsed.unidad)
    } catch {
      stateName = stateParam
    }
  }

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
  let storeName = stateName.trim() || `Tienda ${storeId}`

  if (!stateName.trim()) {
    try {
      // El recurso de datos de la tienda es {store_id}/store — pegar a {store_id}
      // pelado devuelve 404 y dejaba el nombre en "Tienda {id}" (solo números).
      const storeRes = await fetch(`${CONFIG.tiendanube.apiBase}/${storeId}/store`, {
        headers: {
          Authentication: `bearer ${accessToken}`,
          'User-Agent': CONFIG.tiendanube.userAgent,
        },
      })
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        const name = storeData.name
        // El nombre puede venir como string o como objeto multi-idioma { es, pt, … }.
        let resuelto = ''
        if (typeof name === 'string') {
          resuelto = name
        } else if (name && typeof name === 'object') {
          resuelto = name.es || name.pt || Object.values(name).find((v): v is string => typeof v === 'string') || ''
        }
        // Recortar: varios nombres reales vienen con espacios al final (ej. "PROGRESSIVE ").
        if (resuelto.trim()) storeName = resuelto.trim()
      }
    } catch {
      // usar nombre por defecto
    }
  }

  // Guardar en Supabase, en el directorio de tiendas de SU unidad de negocio.
  await runEnUnidad(unidad, () => saveStore({
    storeId,
    storeName,
    accessToken,
    connectedAt: new Date().toISOString(),
    appId: CONFIG.tiendanube.clientId,   // app por la que quedó conectada (para identificar la migración)
  }))

  return NextResponse.redirect(new URL(`/tn-success?storeId=${storeId}`, req.nextUrl.origin))
}
