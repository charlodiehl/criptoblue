import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'
import { monthKeyART } from '@/lib/utils'
import { requireUnidad, setUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesion (el middleware ya valido rol + 2FA).
  const sesion = await requireUnidad()
  if ('error' in sesion) return sesion.error
  setUnidad(sesion.unidad)
  try {
    const hot = await loadHotState()

    // Mes en hora Argentina — debe coincidir con incrementPersistedMonthStats.
    const monthKey = monthKeyART()
    const stats = (hot.persistedMonthStats ?? {})[monthKey] ?? { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }

    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000
    const recentMatches = (hot.recentMatches ?? []).filter(
      m => new Date(m.matchedAt).getTime() >= cutoff48h
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
