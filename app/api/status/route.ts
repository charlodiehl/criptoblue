import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  try {
    const state = await loadState()

    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    const isThisMonth = (ts: string) => {
      const d = new Date(ts)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    }

    const matchedLogs = state.matchLog.filter(e =>
      (e.action === 'manual_paid' || e.action === 'auto_paid') &&
      isThisMonth(e.timestamp) &&
      e.mpPaymentId && !e.mpPaymentId.startsWith('manual_')
    )
    const manualLogs = state.matchLog.filter(e =>
      e.action === 'manual_paid' &&
      isThisMonth(e.timestamp) &&
      e.mpPaymentId?.startsWith('manual_')
    )

    const matchedCount = matchedLogs.length
    const matchedVolume = matchedLogs.reduce((sum, e) => sum + (e.amount || 0), 0)
    const manualCount = manualLogs.length
    const manualVolume = manualLogs.reduce((sum, e) => sum + (e.amount || 0), 0)

    const pendingOrders = state.unmatchedPayments.length

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000
    const recentMatches = (state.recentMatches || []).filter(
      m => new Date(m.matchedAt).getTime() >= cutoff24h
    )

    return NextResponse.json({
      matchedCount,
      matchedVolume,
      manualCount,
      manualVolume,
      pendingOrders,
      lastMPCheck: state.lastMPCheck || null,
      externallyMarkedOrders: state.externallyMarkedOrders || [],
      externallyMarkedPayments: (state.externallyMarkedPayments || []).map(e => e.id),
      recentMatches,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
