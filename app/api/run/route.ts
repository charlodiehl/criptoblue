import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { runAutoMatchCore } from '@/lib/auto-match-runner'
import { audit } from '@/lib/audit'
import { cleanupAuditLogs } from '@/lib/audit'
import { loadHotState, saveHotState, isCronPaused, withStateLock } from '@/lib/storage'
import { porCadaUnidad } from '@/lib/unidad'
import { requireUnidad, setUnidad } from '@/lib/auth/server'

export const maxDuration = 300

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

// Los guardados de estado del ciclo se hacen bajo withStateLock para serializarlos
// con los matches/dismisses manuales (que también toman el lock). Así se cierra el
// "lost update" que re-agregaba a la cola pagos ya emparejados (fantasmas).
// processMPPayments toma el lock internamente para su merge-save; runAutoMatchCore
// adquiere el lock por cada candidato individual.
async function runCycle(triggeredBy: 'cron' | 'manual_button') {
  await audit({
    category: 'system', action: 'cron_cycle.start', result: 'success',
    actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'run',
    message: `Inicio ciclo run (${triggeredBy})`,
  })

  // Fase 1: sync de pagos MP
  const hotBeforeSync = await loadHotState()
  hotBeforeSync.currentPhase = 'syncing'
  await withStateLock('run', 'fase1-syncing', () => saveHotState(hotBeforeSync))

  const syncResult = await processMPPayments()

  // Fase 2: auto-match (el runner setea 'idle' al finalizar)
  const hotBeforeMatch = await loadHotState()
  hotBeforeMatch.currentPhase = 'auto-matching'
  await withStateLock('run', 'fase2-automatching', () => saveHotState(hotBeforeMatch))

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

// GET — cron de Vercel cada 5 min. UN solo cron para las DOS unidades de negocio:
// recorre cada una en serie con su propio estado, su propia cola de pagos y su
// propia pausa. Es el corazón de la infraestructura compartida.
export async function GET() {
  // Solo permitir cron en producción — preview deployments (otras branches) no deben ejecutar ciclos
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ skipped: true, reason: 'cron disabled on non-production deployments' })
  }

  const porUnidad = await porCadaUnidad(async (unidad) => {
    // Pausa de cron (flag kv <unidad>:cron-paused) — usada durante migraciones/
    // mantenimiento. Es por unidad: se puede frenar una sin frenar la otra.
    if (await isCronPaused()) {
      return { skipped: true, reason: `cron paused (${unidad}:cron-paused)` }
    }
    try {
      return await runCycle('cron')
    } catch (err) {
      await audit({
        category: 'error', action: 'cron_cycle.error', result: 'failure',
        actor: 'cron', component: 'run',
        message: `Error en ciclo cron GET (${unidad}): ${String(err)}`,
        error: String(err),
      })
      return { success: false, error: String(err) }
    }
  })

  return NextResponse.json({ porUnidad })
}

// POST — botón manual del panel. Corre SOLO la unidad de quien lo apretó.
export async function POST() {
  const sesion = await requireUnidad()
  if ('error' in sesion) return sesion.error
  setUnidad(sesion.unidad)
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
