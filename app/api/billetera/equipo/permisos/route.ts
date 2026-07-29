import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { getUsuarioBilletera, setPermisosBilletera } from '@/lib/equipo-billetera'
import { puedeGestionarEquipoBilletera, sanearPermisosBilletera } from '@/lib/permisos'

// POST /api/billetera/equipo/permisos { email, permisos: {…} } [?wallet=]
// Edita los permisos de un integrante de la MISMA billetera.
//
// Mismas reglas que en tienda (todas server-side; el front solo las refleja):
//   • Solo puede quien tenga Administración (o el super-admin del sistema).
//   • El objetivo tiene que ser un rol 'billetera' de ESTA billetera.
//   • Nadie edita sus PROPIOS permisos, salvo el super-admin.
//   • QUITAR Administración solo lo hace el super-admin: un administrador de
//     billetera puede darla, pero no sacarla.
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
    const nuevos = sanearPermisosBilletera(body?.permisos)

    const pedida = req.nextUrl.searchParams.get('wallet') || body?.wallet
    const scope = esSuperAdmin ? { wallet: pedida as string | null, permisos: {} } : resolveWalletScope(yo, pedida)
    const wallet = scope?.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    if (!puedeGestionarEquipoBilletera({ role: yo.role, permisos: scope?.permisos ?? {} })) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }
    if (emailTarget === yo.email && !esSuperAdmin) {
      return NextResponse.json({ error: 'No podés editar tus propios permisos' }, { status: 403 })
    }

    const target = await getUsuarioBilletera(emailTarget)
    if (!target || target.role !== 'billetera' || target.wallet !== wallet) {
      return NextResponse.json({ error: 'Ese usuario no es integrante de esta billetera' }, { status: 404 })
    }

    // Se compara contra !== true (y no === false) para que un body que la omite
    // —{ permisos: {} }, que reemplaza el objeto entero— también cuente como quitar.
    const quitaAdministracion = target.permisos.administracion === true && nuevos.administracion !== true
    if (quitaAdministracion && !esSuperAdmin) {
      return NextResponse.json({ error: 'Solo un Super Admin puede quitar el permiso de Administración' }, { status: 403 })
    }

    // Un Administrador tiene TODOS los permisos: al dárselo se activan los demás.
    if (nuevos.administracion === true) {
      nuevos.registrar_retiros = true
      nuevos.ver_saldo = true
    }

    await setPermisosBilletera(emailTarget, wallet, nuevos)
    return NextResponse.json({ success: true, email: emailTarget, permisos: nuevos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
