import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { listarEquipoBilletera } from '@/lib/equipo-billetera'
import { puedeGestionarEquipoBilletera } from '@/lib/permisos'

// GET /api/billetera/equipo[?wallet=] → integrantes de la billetera del usuario.
//
// Aislamiento: la wallet la fija resolveWalletScope contra los accesos del usuario —
// nunca se confía en la que venga en el request. Espejo de /api/tienda/equipo.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const pedida = req.nextUrl.searchParams.get('wallet')
    // El super-admin opera cualquier billetera de su unidad (vista espejo); el resto,
    // solo las de sus accesos.
    const wallet = auth.user.role === 'admin'
      ? (pedida || null)
      : (resolveWalletScope(auth.user, pedida)?.wallet ?? null)
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    const permisos = auth.user.role === 'admin' ? {} : (resolveWalletScope(auth.user, wallet)?.permisos ?? {})
    const miembros = await listarEquipoBilletera(wallet)
    return NextResponse.json({
      miembros,
      yoEmail: auth.user.email,
      puedeGestionar: puedeGestionarEquipoBilletera({ role: auth.user.role, permisos }),
      soySuperAdmin: auth.user.role === 'admin',
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
