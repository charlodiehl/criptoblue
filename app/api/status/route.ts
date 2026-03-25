import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  try {
    const state = await loadState()

    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    // Tarjetas: leen exclusivamente de persistedMonthStats — se acumula en tiempo real con cada match
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
    const stats = (state.persistedMonthStats || {})[monthKey] || { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }

    const matchedCount = stats.matchedCount
    const matchedVolume = stats.matchedVolume
    const manualCount  = stats.manualCount
    const manualVolume = stats.manualVolume

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
