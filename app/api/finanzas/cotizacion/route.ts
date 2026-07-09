import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getUsdtRate } from '@/lib/cotizacion'

// GET /api/finanzas/cotizacion → { rate } ARS por 1 USDT (Binance P2P +0,75%).
// Para el checkbox "Usar cotización estándar". Admin-only.
export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const rate = await getUsdtRate()
    if (!rate) return NextResponse.json({ error: 'No se pudo obtener la cotización en este momento' }, { status: 503 })
    return NextResponse.json({ rate })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
