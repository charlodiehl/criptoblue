import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { getUsuario, agregarMiembro } from '@/lib/equipo'
import { getStores } from '@/lib/storage'
import { puedeGestionarEquipo, sanearPermisos } from '@/lib/permisos'

// POST /api/tienda/equipo/agregar { email, permisos: {…} } [?storeId=]
// Da de alta un integrante en la tienda. Solo quien tenga Administración (o super-admin).
//
// El store_id lo pone el server (resolveStoreScope): un rol 'tienda' solo puede agregar
// gente a SU tienda, nunca a otra. Un email que ya existe NO se reasigna desde acá
// (podría robarse un usuario de otra tienda): eso lo resuelve el super-admin.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    if (!puedeGestionarEquipo(auth.user)) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
    // El que agrega elige si el nuevo es Administrador (tiene todo) u operador (solo los
    // permisos que le marque). Un Administrador tiene todos los permisos activos.
    const permisos = sanearPermisos(body?.permisos)
    if (permisos.administracion === true) {
      permisos.solicitar_transferencias = true
      permisos.solicitar_reembolsos = true
    }

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    // El email no puede existir ya (ni en esta tienda ni en otra ni como admin).
    const existente = await getUsuario(email)
    if (existente) {
      const mismaTienda = existente.role === 'tienda' && existente.storeId === storeId
      return NextResponse.json({
        error: mismaTienda ? 'Ese email ya es integrante de esta tienda' : 'Ese email ya tiene una cuenta en el sistema',
      }, { status: 409 })
    }

    const stores = await getStores()
    const displayName = stores[storeId]?.storeName || 'Tienda'
    await agregarMiembro(email, storeId, displayName, permisos)
    return NextResponse.json({ success: true, email, permisos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
