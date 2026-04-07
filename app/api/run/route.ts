import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { runAutoMatchCore } from '@/lib/auto-match-runner'
import { acquireLock, releaseLock } from '@/lib/storage'

export const maxDuration = 300

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

async function runCycle(triggeredBy: 'cron' | 'manual_button') {
  // Sync de pagos y órdenes (no necesita lock — no marca órdenes)
  const syncResult = await processMPPayments()

  // Auto-match: cada candidato adquiere su propio lock dentro de runAutoMatchCore
  const autoMatch = await runAutoMatchCore(syncResult.stores, triggeredBy)
  return { success: true, ...syncResult, autoMatch }
}

export async function GET() {
  // El cron no necesita lock global — el auto-match lo maneja por candidato.
  // Pero si hay un ciclo ya corriendo, skip para no duplicar.
  const locked = await acquireLock('cycle-run', undefined, 240_000)
  if (!locked) {
    return NextResponse.json({ success: true, skipped: true, reason: 'cycle_already_running' })
  }
  try {
    return NextResponse.json(await runCycle('cron'))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  } finally {
    await releaseLock('cycle-run')
  }
}

export async function POST() {
  const locked = await acquireLock('cycle-run', undefined, 240_000)
  if (!locked) {
    return NextResponse.json({ success: false, error: 'Ya hay un ciclo en ejecución' }, { status: 409 })
  }
  try {
    return NextResponse.json(await runCycle('manual_button'))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  } finally {
    await releaseLock('cycle-run')
  }
}
