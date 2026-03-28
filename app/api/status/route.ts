import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'

export async function GET() {
  try {
    const hot = await loadHotState()

    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
    const stats = (hot.persistedMonthStats ?? {})[monthKey] ?? { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000
    const recentMatches = (hot.recentMatches ?? []).filter(
      m => new Date(m.matchedAt).getTime() >= cutoff24h
    )

    return NextResponse.json({
      matchedCount: stats.matchedCount,
      matchedVolume: stats.matchedVolume,
      manualCount: stats.manualCount,
      manualVolume: stats.manualVolume,
      pendingOrders: (hot.unmatchedPayments ?? []).length, // #12: fallback defensivo
      lastMPCheck: hot.lastMPCheck || null,
      externallyMarkedOrders: hot.externallyMarkedOrders ?? [],
      externallyMarkedPayments: (hot.externallyMarkedPayments ?? []).map(e => e.id),
      recentMatches,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
