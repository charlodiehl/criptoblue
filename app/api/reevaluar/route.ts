import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { loadState, saveState } from '@/lib/storage'

export const maxDuration = 60

export async function POST() {
  try {
    // Reset all paid/pending data, then re-sync last 48h fresh
    const state = await loadState()
    // Limpia todo el estado para re-evaluar las últimas 48h desde cero.
    // También borra processedPayments para que los pagos recientes sean re-procesados.
    state.matchLog = state.matchLog.filter(e => e.action !== 'auto_paid' && e.action !== 'manual_paid')
    state.pendingMatches = []
    state.unmatchedPayments = []
    state.processedPayments = []
    state.lastMPCheck = ''
    await saveState(state)

    const result = await processMPPayments()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
