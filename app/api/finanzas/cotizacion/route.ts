import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getUsdtRate, getUsdtRateSinMargen } from '@/lib/cotizacion'

// GET /api/finanzas/cotizacion → ARS por 1 USDT para el checkbox "Usar cotización
// estándar". Admin-only. Devuelve las dos variantes; el cliente elige según el flujo:
//   rate     → precio de venta Binance P2P + 0,75% (ingresos por órdenes)
//   rateBase → precio de venta puro, +0% (reembolsos y pagos)
export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const [rate, rateBase] = await Promise.all([getUsdtRate(), getUsdtRateSinMargen()])
    if (!rate || !rateBase) return NextResponse.json({ error: 'No se pudo obtener la cotización en este momento' }, { status: 503 })
    return NextResponse.json({ rate, rateBase })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
