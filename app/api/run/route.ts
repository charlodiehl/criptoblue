import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { runAutoMatchCore } from '@/lib/auto-match-runner'

export const maxDuration = 300

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

async function runCycle(triggeredBy: 'cron' | 'manual_button') {
  const syncResult = await processMPPayments()
  const autoMatch = await runAutoMatchCore(syncResult.stores, triggeredBy)
  return { success: true, ...syncResult, autoMatch }
}

export async function GET() {
  try {
    return NextResponse.json(await runCycle('cron'))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runCycle('manual_button'))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
