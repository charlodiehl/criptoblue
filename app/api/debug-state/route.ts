import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  const state = await loadState()
  const unmatched = state.unmatchedPayments.map(u => ({
    id: u.mpPaymentId,
    date: u.payment?.fechaPago,
    amount: u.payment?.monto,
    name: u.payment?.nombrePagador,
  }))
  return NextResponse.json({
    lastMPCheck: state.lastMPCheck,
    processedCount: state.processedPayments.length,
    unmatchedCount: state.unmatchedPayments.length,
    pendingMatchesCount: state.pendingMatches.length,
    unmatchedDates: unmatched.map(u => u.date).sort(),
    recentUnmatched: unmatched.slice(-5),
  })
}
