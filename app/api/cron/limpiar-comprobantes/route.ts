import { NextResponse } from 'next/server'
import { limpiarComprobantesVencidos } from '@/lib/transferencias'

// Cron diario: borra del bucket los comprobantes con más de 60 días y limpia su
// referencia en transfer_requests, para no acumular espacio.
// Auth: CRON_SECRET (lo valida el middleware — ver CRON_ROUTES en proxy.ts).
async function run() {
  try {
    const r = await limpiarComprobantesVencidos(60)
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() { return run() }
export async function POST() { return run() }
