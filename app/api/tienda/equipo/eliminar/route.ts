import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, serviceClient } from '@/lib/auth/server'
import { getUsuario, eliminarMiembro } from '@/lib/equipo'
import { puedeGestionarEquipo } from '@/lib/permisos'

// POST /api/tienda/equipo/eliminar { email } [?storeId=]
// Da de baja (elimina) a un integrante de la MISMA tienda.
//
// Reglas de seguridad (todas server-side; el front solo las refleja):
//   • Solo puede quien tenga Administración (o el Super Admin del sistema).
//   • Aislamiento: el objetivo tiene que ser un rol 'tienda' de ESTA tienda (storeId lo
//     fija resolveStoreScope y eliminarMiembro vuelve a filtrar por store_id).
//   • Nadie se da de baja a sí mismo.
//   • Dar de baja a otro Administrador solo lo hace el Super Admin (igual que quitarle
//     el permiso de Administración): un admin de tienda no puede eliminar a un par.

// Limpia el claim del JWT para bloquear al usuario en el acto. Sin esto, su sesión
// activa seguiría cargando páginas hasta el próximo refresh (aunque las APIs ya lo
// bloquean, porque requireUser no encuentra su fila en app_users). Best-effort.
async function limpiarClaim(email: string) {
  const svc = serviceClient()
  for (let page = 1; page <= 10; page++) {
    const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 })
    const hit = data?.users.find(u => (u.email || '').toLowerCase() === email)
    if (hit) { await svc.auth.admin.updateUserById(hit.id, { app_metadata: { cb_role: null, cb_store_id: null } }); return }
    if (!data || data.users.length < 200) break
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    const yo = auth.user
    const esSuperAdmin = yo.role === 'admin'

    if (!puedeGestionarEquipo(yo)) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const emailTarget = String(body?.email || '').trim().toLowerCase()
    if (!emailTarget) return NextResponse.json({ error: 'Falta el email' }, { status: 400 })

    const storeId = resolveStoreScope(yo, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    if (emailTarget === yo.email) {
      return NextResponse.json({ error: 'No podés darte de baja a vos mismo' }, { status: 403 })
    }

    const target = await getUsuario(emailTarget)
    if (!target || target.role !== 'tienda' || target.storeId !== storeId) {
      return NextResponse.json({ error: 'Ese usuario no es integrante de esta tienda' }, { status: 404 })
    }

    // Dar de baja a un Administrador: solo el Super Admin del sistema.
    if (target.permisos.administracion === true && !esSuperAdmin) {
      return NextResponse.json({ error: 'Solo un Super Admin puede dar de baja a un Administrador' }, { status: 403 })
    }

    const borrado = await eliminarMiembro(emailTarget, storeId)
    if (!borrado) return NextResponse.json({ error: 'No se pudo dar de baja (¿ya no estaba en el equipo?)' }, { status: 404 })

    try { await limpiarClaim(emailTarget) } catch { /* best-effort: la baja ya cortó el acceso vía API */ }

    return NextResponse.json({ success: true, email: emailTarget })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
