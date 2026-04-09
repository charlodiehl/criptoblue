import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { runAutoMatchCore } from '@/lib/auto-match-runner'
import { audit } from '@/lib/audit'
import { cleanupAuditLogs } from '@/lib/audit'

export const maxDuration = 300

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

// El ciclo NO necesita lock global:
// - processMPPayments (sync) es seguro concurrentemente (tiene merge protection)
// - runAutoMatchCore adquiere lock por cada candidato individual
async function runCycle(triggeredBy: 'cron' | 'manual_button') {
  await audit({
    category: 'system', action: 'cron_cycle.start', result: 'success',
    actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'run',
    message: `Inicio ciclo run (${triggeredBy})`,
  })

  const syncResult = await processMPPayments()
  const autoMatch = await runAutoMatchCore(syncResult.stores, triggeredBy)

  // Cleanup solo una vez por día (a las 03:00 UTC ± 1 minuto) para no gastar IO en cada ciclo
  const nowUtc = new Date()
  if (nowUtc.getUTCHours() === 3 && nowUtc.getUTCMinutes() <= 1) {
    cleanupAuditLogs().catch(() => {})
  }
  await audit({
    category: 'system', action: 'cron_cycle.end', result: syncResult.errors.length > 0 ? 'partial' : 'success',
    actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'run',
    message: `Ciclo run finalizado (${triggeredBy}): ${syncResult.processed} pagos, ${autoMatch.matched} matched`,
    meta: { processed: syncResult.processed, matched: autoMatch.matched, errors: syncResult.errors.length },
  })

  return { success: true, ...syncResult, autoMatch }
}

export async function GET() {
  // Solo permitir cron en producción — preview deployments (otras branches) no deben ejecutar ciclos
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ skipped: true, reason: 'cron disabled on non-production deployments' })
  }

  try {
    return NextResponse.json(await runCycle('cron'))
  } catch (err) {
    await audit({
      category: 'error', action: 'cron_cycle.error', result: 'failure',
      actor: 'cron', component: 'run',
      message: `Error en ciclo cron GET: ${String(err)}`,
      error: String(err),
    })
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runCycle('manual_button'))
  } catch (err) {
    await audit({
      category: 'error', action: 'cron_cycle.error', result: 'failure',
      actor: 'human', component: 'run',
      message: `Error en ciclo manual POST: ${String(err)}`,
      error: String(err),
    })
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
