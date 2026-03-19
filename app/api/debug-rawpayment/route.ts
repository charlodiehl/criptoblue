import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  const state = await loadState()
  const payment = state.cachedPayments?.[0]
  if (!payment) return NextResponse.json({ error: 'No hay pagos en caché' }, { status: 404 })
  return NextResponse.json(payment.rawData ?? { error: 'Este pago no tiene rawData' })
}
