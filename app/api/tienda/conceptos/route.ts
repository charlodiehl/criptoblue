import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, scopedUser, setUnidad } from '@/lib/auth/server'
import { puede } from '@/lib/permisos'
import { getConceptos, usarConcepto } from '@/lib/conceptos'

// GET /api/tienda/conceptos[?storeId=] → lista de conceptos de la tienda (LRU, máx 10).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })
    return NextResponse.json({ conceptos: await getConceptos(storeId) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/tienda/conceptos { nombre } [?storeId=] → agrega/renueva un concepto.
// Permiso: quien puede solicitar transferencias (mismo gate que crear una).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const body = await req.json().catch(() => null)
    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })
    if (!puede(scopedUser(auth.user, storeId), 'solicitar_transferencias')) {
      return NextResponse.json({ error: 'No tenés permiso para gestionar conceptos' }, { status: 403 })
    }
    const nombre = String(body?.nombre || '').trim()
    if (!nombre) return NextResponse.json({ error: 'Escribí el concepto' }, { status: 400 })
    return NextResponse.json({ conceptos: await usarConcepto(storeId, nombre) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
