import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

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

    // Total de pagos en cola de revisión manual (todos los sin confirmar)
    const pendingOrders = state.unmatchedPayments.length

    // Pagos sin identificar ingresados este mes
    const pendingPayments = state.unmatchedPayments.filter(p =>
      isThisMonth(p.timestamp)
    ).length

    return NextResponse.json({
      paidThisMonth,
      paidVolumeThisMonth,
      pendingOrders,
      pendingPayments,
      lastMPCheck: state.lastMPCheck || null,
      externallyMarkedOrders: state.externallyMarkedOrders || [],
      externallyMarkedPayments: state.externallyMarkedPayments || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
