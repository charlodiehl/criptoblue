import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, setUnidad } from '@/lib/auth/server'
import { listarRefundRequestsTienda } from '@/lib/reembolsos'

// GET /api/tienda/reembolsos[?storeId=]
// Solicitudes de reembolso propias de la tienda (para "Mis solicitudes").
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const solicitudes = await listarRefundRequestsTienda(storeId)
    return NextResponse.json({ solicitudes })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
