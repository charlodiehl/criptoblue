import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { loadHotState, saveHotState, loadProcessed, saveProcessed, loadLogs, saveLogs, getStores, appendError, appendActivity, withStateLock } from '@/lib/storage'
import { runAutoMatchCore } from '@/lib/auto-match-runner'
import { audit } from '@/lib/audit'
import { porCadaUnidad } from '@/lib/unidad'
import { requireUnidad } from '@/lib/auth/server'

export const maxDuration = 300

// Auth manejada por proxy.ts — GET requiere CRON_SECRET, POST requiere sesión

// Ciclo completo: sync + auto-match (solo desde botón manual)
async function runFullCycle(triggeredBy: 'cron' | 'manual_button') {
  await audit({
    category: 'system', action: 'reevaluar.start', result: 'success',
    actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'reevaluar',
    message: `Inicio reevaluación completa (${triggeredBy})`,
  })

  // Fase 1: resetear estado para reevaluación fresca
  const [hot, processed, logs] = await Promise.all([loadHotState(), loadProcessed(), loadLogs()])

  // Guardar backup de unmatchedPayments para restaurar en caso de error (#M2)
  const backupUnmatched = [...hot.unmatchedPayments]
  const backupProcessed = [...processed.processedPayments]

  hot.unmatchedPayments = []
  hot.currentPhase = 'syncing'
  processed.processedPayments = []
  appendActivity(logs, triggeredBy === 'cron' ? 'system' : 'human', triggeredBy === 'cron' ? 'reevaluar_automatico' : 'reevaluar_manual')
  // Bajo lock: el guardado (que pasa por el merge de saveHotState) debe leer un
  // `current` consistente para no re-agregar a la cola un pago que un match manual
  // acaba de emparejar (fantasma). Ver withStateLock.
  await withStateLock('reevaluar', 'fase1-reset', () =>
    Promise.all([saveHotState(hot), saveProcessed(processed), saveLogs(logs)])
  )

  // Fase 2: sync de pagos de MP y órdenes
  let cycleResult
  try {
    cycleResult = await processMPPayments()
  } catch (err) {
    // Restaurar datos si el sync falla (#M2)
    const [restoreHot, restoreProcessed, restoreLogs] = await Promise.all([loadHotState(), loadProcessed(), loadLogs()])
    if (restoreHot.unmatchedPayments.length === 0) {
      restoreHot.unmatchedPayments = backupUnmatched
    }
    if (restoreProcessed.processedPayments.length === 0) {
      restoreProcessed.processedPayments = backupProcessed
    }
    restoreHot.currentPhase = 'idle'
    appendError(restoreLogs, 'reevaluar', 'error', `Sync falló, restaurando datos: ${String(err)}`)
    await audit({
      category: 'system', action: 'reevaluar.restore', result: 'failure',
      actor: triggeredBy === 'cron' ? 'cron' : 'human', component: 'reevaluar',
      message: `Sync falló, restaurando backup: ${String(err)}`,
      error: String(err),
    })
    await withStateLock('reevaluar', 'restore', () =>
      Promise.all([saveHotState(restoreHot), saveProcessed(restoreProcessed), saveLogs(restoreLogs)])
    )
    throw err
  }

  // Fase 3: auto-matching (solo si triggeredBy es manual_button)
  if (triggeredBy === 'manual_button') {
    const [freshHot, stores] = await Promise.all([loadHotState(), getStores()])
    freshHot.currentPhase = 'auto-matching'
    await withStateLock('reevaluar', 'fase3-pre', () => saveHotState(freshHot))

    const { matched, errors } = await runAutoMatchCore(stores, triggeredBy)
    return NextResponse.json({ success: true, ...cycleResult, autoMatched: matched, autoMatchErrors: errors.length })
  }

  // Cron: solo sync, sin auto-match
  const freshHot = await loadHotState()
  freshHot.currentPhase = 'idle'
  await withStateLock('reevaluar', 'cron-idle', () => saveHotState(freshHot))

  return NextResponse.json({ success: true, ...cycleResult })
}

// GET — cron de Vercel: solo sync de pagos y órdenes, sin auto-match.
// Los guardados de estado se hacen bajo withStateLock (serializados con los
// matches/dismisses manuales) para cerrar el "lost update" que re-agregaba
// pagos ya emparejados a la cola (fantasmas). El merge de saveHotState por sí
// solo NO alcanza: sin candado puede leer un `current` inconsistente (un match
// a mitad de commit) y no excluir el pago. runAutoMatchCore ya toma el lock por
// cada candidato individual.
export async function GET() {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ skipped: true, reason: 'cron disabled on non-production deployments' })
  }

  // Una pasada por cada unidad de negocio, con su propio estado y su propia cola.
  const porUnidad = await porCadaUnidad(async () => {
    try {
      return await (await runFullCycle('cron')).json()
    } catch (err) {
      try {
        const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
        hot.currentPhase = 'idle'
        appendError(logs, 'reevaluar', 'error', `Error inesperado en ciclo automático (GET): ${String(err)}`)
        await withStateLock('reevaluar', 'get-error', () =>
          Promise.all([saveHotState(hot), saveLogs(logs)])
        )
      } catch { /* no bloquear si falla el logging */ }
      return { success: false, error: String(err) }
    }
  })
  return NextResponse.json({ porUnidad })
}

// POST — botón manual: sync + auto-match completo. Solo la unidad de quien lo apretó.
export async function POST() {
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    return await runFullCycle('manual_button')
  } catch (err) {
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      hot.currentPhase = 'idle'
      appendError(logs, 'reevaluar', 'error', `Error inesperado en ciclo manual (POST): ${String(err)}`)
      await withStateLock('reevaluar', 'post-error', () =>
        Promise.all([saveHotState(hot), saveLogs(logs)])
      )
    } catch { /* no bloquear si falla el logging */ }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
