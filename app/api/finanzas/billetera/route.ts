import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getIngresosBilletera, getBilleterasOcultas, getDiasConMovimiento } from '@/lib/billeteras'
import { walletsDeUnidad } from '@/lib/unidad'

// GET /api/finanzas/billetera?wallet=MS[&fecha=YYYY-MM-DD] → total + extracto (del
// día si se pasa fecha) + los días que tuvieron movimiento (para el calendario).
// Admin-only.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim()
    if (!wallet || !walletsDeUnidad().includes(wallet)) {
      return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
    }

    const ocultas = await getBilleterasOcultas()
    if (ocultas.includes(wallet)) {
      return NextResponse.json({ error: 'Billetera no disponible' }, { status: 404 })
    }

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
