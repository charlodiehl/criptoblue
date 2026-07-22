import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, scopedUser } from '@/lib/auth/server'
import { getUsuario, setPermisos } from '@/lib/equipo'
import { puedeGestionarEquipo, sanearPermisos } from '@/lib/permisos'

// POST /api/tienda/equipo/permisos { email, permisos: {…} } [?storeId=]
// Edita los permisos de un integrante de la MISMA tienda.
//
// Reglas de seguridad (todas server-side; el front solo refleja esto):
//   • Solo puede editar quien tenga Administración (o el super-admin del sistema).
//   • Aislamiento: el objetivo tiene que ser un rol 'tienda' de ESTA tienda. Un usuario
//     de una tienda nunca toca a alguien de otra (storeId lo fija resolveStoreScope y
//     además setPermisos vuelve a filtrar por store_id).
//   • Nadie edita sus PROPIOS permisos (evita auto-escalar o auto-bloquearse). Solo el
//     super-admin del sistema puede.
//   • QUITAR el permiso de Administración (true→false) solo lo hace el super-admin del
//     sistema. Un administrador de tienda puede darlo, pero no sacarlo.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    const yo = auth.user
    const esSuperAdmin = yo.role === 'admin'

    const body = await req.json().catch(() => null)
    const emailTarget = String(body?.email || '').trim().toLowerCase()
    if (!emailTarget) return NextResponse.json({ error: 'Falta el email' }, { status: 400 })
    const nuevos = sanearPermisos(body?.permisos)

    const storeId = resolveStoreScope(yo, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    // Permiso de Administración EN ESA tienda (puede ser un acceso secundario).
    if (!puedeGestionarEquipo(scopedUser(yo, storeId))) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }

    // No editar los propios permisos (salvo super-admin del sistema).
    if (emailTarget === yo.email && !esSuperAdmin) {
      return NextResponse.json({ error: 'No podés editar tus propios permisos' }, { status: 403 })
    }

    // El objetivo tiene que ser un integrante 'tienda' de ESTA tienda.
    const target = await getUsuario(emailTarget)
    if (!target || target.role !== 'tienda' || target.storeId !== storeId) {
      return NextResponse.json({ error: 'Ese usuario no es integrante de esta tienda' }, { status: 404 })
    }

    // DAR Administración lo puede un administrador de tienda; QUITARLA solo el Super Admin.
    // Se compara contra !== true (y no === false) para que un body que la omite
    // —{ permisos: {} }, que reemplazaría la columna entera— también cuente como quitar.
    const quitaAdministracion = target.permisos.administracion === true && nuevos.administracion !== true
    if (quitaAdministracion && !esSuperAdmin) {
      return NextResponse.json({ error: 'Solo un Super Admin puede quitar el permiso de Administración' }, { status: 403 })
    }

    // Un Administrador tiene TODOS los permisos: al dárselo se activan los demás.
    if (nuevos.administracion === true) {
      nuevos.solicitar_transferencias = true
      nuevos.solicitar_reembolsos = true
    }

    await setPermisos(emailTarget, storeId, nuevos)
    return NextResponse.json({ success: true, email: emailTarget, permisos: nuevos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
