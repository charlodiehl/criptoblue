import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

// GET → devuelve status + unmatchedPayments en una sola lectura a Supabase
// Reemplaza el polling paralelo de /api/status y /api/unmatched-payments (2 reads → 1 read cada 5s)
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

    // Emparejados: confirmados desde pestaña Emparejamiento (source='emparejamiento' o auto_paid)
    // Compat. hacia atrás: entradas sin source con ID real de MP (pre-field) van a tarjeta 1
    const matchedLogs = state.matchLog.filter(e =>
      (e.action === 'manual_paid' || e.action === 'auto_paid') &&
      isThisMonth(e.timestamp) &&
      (
        e.source === 'emparejamiento' ||
        (!e.source && e.mpPaymentId && !e.mpPaymentId.startsWith('manual_'))
      )
    )
    // Marcados manualmente: desde pestaña Pagos (manual_pagos) u Órdenes (manual_ordenes)
    // Compat. hacia atrás: entradas sin source con ID sintético (manual_) van a tarjeta 2
    const manualLogs = state.matchLog.filter(e =>
      e.action === 'manual_paid' &&
      isThisMonth(e.timestamp) &&
      (
        e.source === 'manual_pagos' ||
        e.source === 'manual_ordenes' ||
        (!e.source && e.mpPaymentId?.startsWith('manual_'))
      )
    )

    // Base persistida: stats acumuladas de borrados de registro anteriores este mes
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
    const base = (state.persistedMonthStats || {})[monthKey] || { matchedCount: 0, matchedVolume: 0, manualCount: 0, manualVolume: 0 }

    const matchedCount = base.matchedCount + matchedLogs.length
    const matchedVolume = base.matchedVolume + matchedLogs.reduce((sum, e) => sum + (e.amount || 0), 0)
    const manualCount  = base.manualCount   + manualLogs.length
    const manualVolume = base.manualVolume  + manualLogs.reduce((sum, e) => sum + (e.amount || 0), 0)

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
      lastAutoMatchAt: state.lastAutoMatchAt || null,
      lastAutoMatchMatched: state.lastAutoMatchMatched ?? 0,
      externallyMarkedOrders: state.externallyMarkedOrders || [],
      externallyMarkedPayments: (state.externallyMarkedPayments || []).map(e => e.id),
      recentMatches,
      unmatchedPayments: state.unmatchedPayments,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
