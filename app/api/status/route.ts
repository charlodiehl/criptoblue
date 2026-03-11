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

    const paidLogs = state.matchLog.filter(e =>
      (e.action === 'manual_paid' || e.action === 'auto_paid') && isThisMonth(e.timestamp)
    )

    // Órdenes marcadas como pagadas este mes (auto + manual) — se resetea el 1ro de cada mes
    const paidThisMonth = paidLogs.length

    // Volumen total de pagos identificados este mes
    const paidVolumeThisMonth = paidLogs.reduce((sum, e) => sum + (e.amount || 0), 0)

    // Órdenes pendientes de confirmar (en cola de revisión/match)
    const pendingOrders = state.pendingMatches.length

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
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
