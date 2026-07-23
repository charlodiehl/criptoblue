import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { getIngresosBilletera, getBilleterasOcultas, getDiasConMovimiento } from '@/lib/billeteras'

// GET /api/billetera?wallet=<w>[&fecha=YYYY-MM-DD] → total + extracto + días con
// movimiento. La wallet pedida se VALIDA contra los accesos del usuario (multi-acceso):
// solo devuelve datos de una billetera que el usuario tiene asignada — nunca se confía
// en el cliente. Rol 'billetera' (editor o lectura).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('billetera')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const scope = resolveWalletScope(auth.user, req.nextUrl.searchParams.get('wallet'))
    if (!scope) return NextResponse.json({ error: 'Billetera no autorizada' }, { status: 403 })
    const wallet = scope.wallet

    const ocultas = await getBilleterasOcultas()
    if (ocultas.includes(wallet)) return NextResponse.json({ error: 'Billetera no disponible' }, { status: 404 })

    const fecha = req.nextUrl.searchParams.get('fecha') || undefined
    const [detalle, dias] = await Promise.all([
      getIngresosBilletera(wallet, fecha),
      getDiasConMovimiento(wallet),
    ])
    return NextResponse.json({ ...detalle, dias })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
