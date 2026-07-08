import { NextResponse } from 'next/server'
import { backfillCotizacionesPendientes } from '@/lib/balance'

// Cron cada 10 min: completa la cotización USDT de todas las órdenes que todavía
// no la tienen (rate_source='pendiente') con la cotización actual (Binance P2P +0,5%).
// Auth: CRON_SECRET (lo valida el middleware — ver CRON_ROUTES en proxy.ts).
async function run() {
  try {
    const r = await backfillCotizacionesPendientes()
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() { return run() }
export async function POST() { return run() }
