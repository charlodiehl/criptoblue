import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, setUnidad } from '@/lib/auth/server'
import { getAdjudicacionesTienda } from '@/lib/registro'

// GET /api/tienda/reclamos[?storeId=]
// Historial de pagos que la tienda se adjudicó desde "Buscar pagos", con su estado
// (pendiente / adjudicada / rechazada). Para la lista debajo del buscador.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const adjudicaciones = await getAdjudicacionesTienda(storeId)
    return NextResponse.json({ adjudicaciones })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
