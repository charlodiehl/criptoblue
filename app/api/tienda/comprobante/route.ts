import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { getSolicitudById, urlComprobante } from '@/lib/transferencias'

// GET /api/tienda/comprobante?id={transferId}[&storeId=]
// Redirige a la URL firmada del comprobante, verificando que la solicitud sea de
// la tienda del usuario (rol tienda) o de la tienda pedida (admin).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const id = Number(req.nextUrl.searchParams.get('id'))
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const solicitud = await getSolicitudById(id)
    if (!solicitud || !solicitud.comprobantePath) {
      return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    }

    // Scope: la solicitud debe pertenecer a la tienda del scope resuelto.
    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (auth.user.role === 'tienda' && solicitud.storeId !== storeId) {
      return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
    }

    const url = await urlComprobante(solicitud.comprobantePath)
    if (!url) return NextResponse.json({ error: 'No se pudo generar el enlace' }, { status: 500 })
    return NextResponse.redirect(url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
