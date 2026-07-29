import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, serviceClient, setUnidad } from '@/lib/auth/server'
import { getUsuarioBilletera, eliminarMiembroBilletera } from '@/lib/equipo-billetera'
import { puedeGestionarEquipoBilletera } from '@/lib/permisos'

// POST /api/billetera/equipo/eliminar { email } [?wallet=]
// Da de baja a un integrante de la MISMA billetera. Espejo de la baja en tienda:
//   • Solo quien tenga Administración (o el super-admin del sistema).
//   • El objetivo tiene que ser un rol 'billetera' de ESTA billetera.
//   • Nadie se da de baja a sí mismo.
//   • Dar de baja a un Administrador solo lo hace el super-admin.

// Limpia el claim del JWT para bloquearlo en el acto. Sin esto, su sesión activa
// seguiría cargando páginas hasta el próximo refresh (aunque las APIs ya lo
// bloquean, porque requireUser no encuentra su fila). Best-effort.
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
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const yo = auth.user
    const esSuperAdmin = yo.role === 'admin'

    const body = await req.json().catch(() => null)
    const emailTarget = String(body?.email || '').trim().toLowerCase()
    if (!emailTarget) return NextResponse.json({ error: 'Falta el email' }, { status: 400 })

    const pedida = req.nextUrl.searchParams.get('wallet') || body?.wallet
    const scope = esSuperAdmin ? { wallet: pedida as string | null, permisos: {} } : resolveWalletScope(yo, pedida)
    const wallet = scope?.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    if (!puedeGestionarEquipoBilletera({ role: yo.role, permisos: scope?.permisos ?? {} })) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }
    if (emailTarget === yo.email) {
      return NextResponse.json({ error: 'No podés darte de baja a vos mismo' }, { status: 403 })
    }

    const target = await getUsuarioBilletera(emailTarget)
    if (!target || target.role !== 'billetera' || target.wallet !== wallet) {
      return NextResponse.json({ error: 'Ese usuario no es integrante de esta billetera' }, { status: 404 })
    }
    if (target.permisos.administracion === true && !esSuperAdmin) {
      return NextResponse.json({ error: 'Solo un Super Admin puede dar de baja a un Administrador' }, { status: 403 })
    }

    const borrado = await eliminarMiembroBilletera(emailTarget, wallet)
    if (!borrado) return NextResponse.json({ error: 'No se pudo dar de baja (¿ya no estaba en el equipo?)' }, { status: 404 })

    try { await limpiarClaim(emailTarget) } catch { /* best-effort: la baja ya cortó el acceso vía API */ }

    return NextResponse.json({ success: true, email: emailTarget })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
