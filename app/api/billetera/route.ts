import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getIngresosBilletera, getBilleterasOcultas, getDiasConMovimiento } from '@/lib/billeteras'

// GET /api/billetera[?fecha=YYYY-MM-DD] → total + extracto + días con movimiento,
// SIEMPRE de la billetera del usuario (app_users.wallet). Ignora cualquier wallet
// del request: el scoping es server-side, nunca se confía en el cliente.
// Rol 'billetera' (editor o lectura).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('billetera')
    if ('error' in auth) return auth.error

    const wallet = auth.user.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

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
