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
    const monthKey = now.toISOString().slice(0, 7) // "YYYY-MM"

    const isThisMonth = (ts: string) => {
      const d = new Date(ts)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    }

    // Acumulador mensual persistente (no se borra con el registro)
    const monthly = (state.monthlyStats || {})[monthKey] || { count: 0, volume: 0 }

    // Fallback: si monthlyStats no tiene datos aún, reconstruir desde matchLog
    const paidLogs = state.matchLog.filter(e =>
      (e.action === 'manual_paid' || e.action === 'auto_paid') && isThisMonth(e.timestamp)
    )
    const paidThisMonth = monthly.count > 0 ? monthly.count : paidLogs.length
    const paidVolumeThisMonth = monthly.volume > 0 ? monthly.volume : paidLogs.reduce((sum, e) => sum + (e.amount || 0), 0)

    const pendingOrders = state.unmatchedPayments.length
    const pendingPayments = state.unmatchedPayments.filter(p => isThisMonth(p.timestamp)).length

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000
    const recentMatches = (state.recentMatches || []).filter(
      m => new Date(m.matchedAt).getTime() >= cutoff24h
    )

    return NextResponse.json({
      // Campos de /api/status
      paidThisMonth,
      paidVolumeThisMonth,
      pendingOrders,
      pendingPayments,
      lastMPCheck: state.lastMPCheck || null,
      externallyMarkedOrders: state.externallyMarkedOrders || [],
      externallyMarkedPayments: state.externallyMarkedPayments || [],
      recentMatches,
      // Campos de /api/unmatched-payments
      unmatchedPayments: state.unmatchedPayments,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
