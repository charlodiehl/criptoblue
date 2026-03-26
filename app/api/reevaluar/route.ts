import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { processMPPayments } from '@/lib/cycle'
import { loadState, saveState, getStores, appendError, appendActivity } from '@/lib/storage'
import { runAutoMatchCore } from '@/lib/auto-match-runner'

// maxDuration aumentado para cubrir sync + auto-match (con delays de 5s entre marcados)
export const maxDuration = 300

// Auth para cron de Vercel (usa CRON_SECRET en header)
function isCronAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  const bearer = req.headers.get('authorization')
  const custom = req.headers.get('x-cron-secret')
  return bearer === `Bearer ${cronSecret}` || custom === cronSecret
}

// Auth para botón manual del browser (usa cookie de sesión)
function isSessionAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('cb_session')?.value
  if (!token) return false
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  const username = process.env.AUTH_USERNAME || 'Benancio'
  const expected = createHmac('sha256', secret).update(username).digest('hex')
  return token === expected
}

async function runFullCycle(triggeredBy: 'cron' | 'manual_button') {
  // Fase 1: syncing
  const state = await loadState()
  state.unmatchedPayments = []
  state.processedPayments = []
  state.currentPhase = 'syncing'
  appendActivity(state, triggeredBy === 'cron' ? 'system' : 'human', triggeredBy === 'cron' ? 'reevaluar_automatico' : 'reevaluar_manual')
  await saveState(state)

  // Procesar pagos de MP y órdenes
  const cycleResult = await processMPPayments()

  // Fase 2: auto-matching — carga estado fresco con los datos del sync
  const [freshState, stores] = await Promise.all([loadState(), getStores()])
  freshState.currentPhase = 'auto-matching'
  await saveState(freshState)

  const { matched, errors } = await runAutoMatchCore(freshState, stores, triggeredBy)

  return NextResponse.json({ success: true, ...cycleResult, autoMatched: matched, autoMatchErrors: errors.length })
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runFullCycle('cron')
  } catch (err) {
    try {
      const state = await loadState()
      state.currentPhase = 'idle'
      appendError(state, 'reevaluar', 'error', `Error inesperado en ciclo automático (GET): ${String(err)}`)
      await saveState(state)
    } catch { /* no bloquear si falla el logging */ }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isSessionAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runFullCycle('manual_button')
  } catch (err) {
    try {
      const state = await loadState()
      state.currentPhase = 'idle'
      appendError(state, 'reevaluar', 'error', `Error inesperado en ciclo manual (POST): ${String(err)}`)
      await saveState(state)
    } catch { /* no bloquear si falla el logging */ }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
