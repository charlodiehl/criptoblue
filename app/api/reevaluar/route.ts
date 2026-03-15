import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { loadState, saveState } from '@/lib/storage'

export const maxDuration = 60

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  const bearer = req.headers.get('authorization')
  const custom = req.headers.get('x-cron-secret')
  return bearer === `Bearer ${cronSecret}` || custom === cronSecret
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const state = await loadState()
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

export async function POST(_req: Request) {
  try {
    // Reset all paid/pending data, then re-sync last 48h fresh
    const state = await loadState()
    // Re-sincroniza las últimas 48h desde cero.
    // Los manual_paid se preservan siempre (son el historial del usuario).
    // El contador mensual se reinicia solo el 1ro de cada mes via isThisMonth() en /api/status.
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
