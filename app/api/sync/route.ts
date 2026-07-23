import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'
import { monthKeyART } from '@/lib/utils'
import { requireUnidad } from '@/lib/auth/server'

// GET → devuelve status + unmatchedPayments en una sola lectura a Supabase
export async function GET() {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const hot = await loadHotState()

    // Mes en hora Argentina — debe coincidir con incrementPersistedMonthStats.
    const monthKey = monthKeyART()
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
      lastAutoMatchAt: hot.lastAutoMatchAt || null,
      lastAutoMatchMatched: hot.lastAutoMatchMatched ?? 0,
      externallyMarkedOrders: hot.externallyMarkedOrders ?? [],
      externallyMarkedPayments: (hot.externallyMarkedPayments ?? []).map(e => e.id),
      recentMatches,
      unmatchedPayments: hot.unmatchedPayments ?? [],
      currentPhase: hot.currentPhase || 'idle',
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
