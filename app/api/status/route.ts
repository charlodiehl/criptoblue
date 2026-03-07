import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  try {
    const state = await loadState()

    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const recentLogs = state.matchLog.filter(
      e => new Date(e.timestamp) >= oneDayAgo
    )

    const manualPaid = recentLogs.filter(
      e => e.action === 'manual_paid' || e.action === 'auto_paid'
    ).length

    const totalAmount = recentLogs
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
      .reduce((sum, e) => sum + (e.amount || 0), 0)

    return NextResponse.json({
      pendingMatch: state.pendingMatches.length,
      manualPaid,
      noMatch: state.unmatchedPayments.length,
      totalAmount,
      processedPayments: state.processedPayments.length,
      lastMPCheck: state.lastMPCheck,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
