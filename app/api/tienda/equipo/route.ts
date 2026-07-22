import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, scopedUser } from '@/lib/auth/server'
import { listarEquipo } from '@/lib/equipo'
import { puedeGestionarEquipo } from '@/lib/permisos'

// GET /api/tienda/equipo[?storeId=] → integrantes de la tienda del usuario.
//
// Aislamiento: el storeId lo fija resolveStoreScope — un rol 'tienda' SIEMPRE ve su
// propia tienda (ignora el storeId del request); solo el super-admin (vista espejo)
// puede pasar otro. Nunca se listan usuarios de otra tienda.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const miembros = await listarEquipo(storeId)
    return NextResponse.json({
      miembros,
      yoEmail: auth.user.email,
      puedeGestionar: puedeGestionarEquipo(scopedUser(auth.user, storeId)),   // gestión EN esa tienda
      soySuperAdmin: auth.user.role === 'admin',          // el super-admin puede editarse y quitar Administración
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
