import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { getUsuarioBilletera, agregarMiembroBilletera } from '@/lib/equipo-billetera'
import { puedeGestionarEquipoBilletera, sanearPermisosBilletera } from '@/lib/permisos'
import { walletsDeUnidad } from '@/lib/unidad'

// POST /api/billetera/equipo/agregar { email, permisos: {…} } [?wallet=]
// Da de alta un integrante en la billetera. Solo quien tenga Administración (o super-admin).
//
// La wallet la fija el server (resolveWalletScope): un rol 'billetera' solo puede
// agregar gente a las SUYAS. Un email que ya existe NO se reasigna desde acá.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const esSuperAdmin = auth.user.role === 'admin'

    const body = await req.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 400 })

    const pedida = req.nextUrl.searchParams.get('wallet') || body?.wallet
    const scope = esSuperAdmin ? { wallet: pedida as string | null, permisos: {} } : resolveWalletScope(auth.user, pedida)
    const wallet = scope?.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    // La billetera tiene que ser de ESTA unidad de negocio: sin esto, un super-admin
    // podría dar de alta a alguien en una billetera que su unidad ni opera.
    if (!walletsDeUnidad().includes(wallet)) {
      return NextResponse.json({ error: 'Esa billetera no pertenece a tu unidad de negocio' }, { status: 403 })
    }

    if (!puedeGestionarEquipoBilletera({ role: auth.user.role, permisos: scope?.permisos ?? {} })) {
      return NextResponse.json({ error: 'No tenés permiso de Administración' }, { status: 403 })
    }

    // Un Administrador tiene todos los permisos activos.
    const permisos = sanearPermisosBilletera(body?.permisos)
    if (permisos.administracion === true) {
      permisos.registrar_retiros = true
      permisos.ver_saldo = true
    }

    const existente = await getUsuarioBilletera(email)
    if (existente) {
      const misma = existente.role === 'billetera' && existente.wallet === wallet
      return NextResponse.json({
        error: misma ? 'Ese email ya es integrante de esta billetera' : 'Ese email ya tiene una cuenta en el sistema',
      }, { status: 409 })
    }

    await agregarMiembroBilletera(email, wallet, wallet, permisos)
    return NextResponse.json({ success: true, email, permisos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
