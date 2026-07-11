import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getUsdtRateSinMargen } from '@/lib/cotizacion'

// GET /api/tienda/cotizacion → { rate } ARS por 1 USDT, precio de VENTA de Binance
// P2P sin margen (+0%). Sirve para mostrar el saldo de la tienda también en pesos.
//
// Accesible a cualquier usuario logueado (tienda o admin): la tienda ve su propio
// saldo, y la vista espejo del admin usa el mismo componente. El valor no depende
// de la tienda, así que no hace falta scope.
export async function GET() {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const rate = await getUsdtRateSinMargen()
    if (!rate) return NextResponse.json({ error: 'No se pudo obtener la cotización en este momento' }, { status: 503 })
    return NextResponse.json({ rate })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
