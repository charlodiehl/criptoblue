import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getMatchId } from '@/lib/storage'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const state = await loadState()

    // Try pendingMatches first
    const matchIndex = state.pendingMatches.findIndex(m => getMatchId(m) === mpPaymentId)
    if (matchIndex >= 0) {
      const match = state.pendingMatches[matchIndex]
      state.pendingMatches.splice(matchIndex, 1)
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        action: 'dismissed',
        payment: match.payment,
        mpPaymentId: match.payment.mpPaymentId,
        amount: match.payment.monto,
      }
      state.matchLog.push(logEntry)
      await saveState(state)
      return NextResponse.json({ success: true })
    }

    // Try unmatchedPayments
    const unmatchedIndex = state.unmatchedPayments.findIndex(u => getMatchId(u) === mpPaymentId)
    if (unmatchedIndex >= 0) {
      const unmatched = state.unmatchedPayments[unmatchedIndex]
      state.unmatchedPayments.splice(unmatchedIndex, 1)
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        action: 'dismissed',
        payment: unmatched.payment,
        mpPaymentId: unmatched.payment.mpPaymentId,
        amount: unmatched.payment.monto,
      }
      state.matchLog.push(logEntry)
      await saveState(state)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
