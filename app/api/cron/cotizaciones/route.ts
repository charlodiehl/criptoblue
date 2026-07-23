import { NextResponse } from 'next/server'
import { backfillCotizacionesPendientes } from '@/lib/balance'
import { porCadaUnidad } from '@/lib/unidad'

// Cron cada 10 min: completa la cotización USDT de todas las órdenes que todavía
// no la tienen (rate_source='pendiente') con la cotización actual (Binance P2P +0,5%).
// Auth: CRON_SECRET (lo valida el middleware — ver CRON_ROUTES en proxy.ts).
//
// INFRAESTRUCTURA COMPARTIDA: la cotización es la misma para todos (sale de Binance,
// no del negocio), así que hay UN solo cron. Lo único que se hace por unidad es
// escribir el backfill en las órdenes de cada una.
async function run() {
  try {
    const porUnidad = await porCadaUnidad(() => backfillCotizacionesPendientes())
    return NextResponse.json({ success: true, porUnidad })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() { return run() }
export async function POST() { return run() }
