import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'
import { loadHotState, saveHotState, loadProcessed, saveProcessed, loadLogs, saveLogs, getStores, appendError, appendActivity } from '@/lib/storage'
import { runAutoMatchCore } from '@/lib/auto-match-runner'

export const maxDuration = 300

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

// #1: Arreglada race condition — usa solo cargas parciales, nunca mezcla loadState con saveLogs
async function runFullCycle(triggeredBy: 'cron' | 'manual_button') {
  // Fase 1: resetear estado para reevaluación fresca
  const [hot, processed, logs] = await Promise.all([loadHotState(), loadProcessed(), loadLogs()])

  // Guardar backup de unmatchedPayments para restaurar en caso de error (#M2)
  const backupUnmatched = [...hot.unmatchedPayments]
  const backupProcessed = [...processed.processedPayments]

  hot.unmatchedPayments = []
  hot.currentPhase = 'syncing'
  processed.processedPayments = []
  appendActivity(logs, triggeredBy === 'cron' ? 'system' : 'human', triggeredBy === 'cron' ? 'reevaluar_automatico' : 'reevaluar_manual')
  await Promise.all([saveHotState(hot), saveProcessed(processed), saveLogs(logs)])

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
    await Promise.all([saveHotState(restoreHot), saveProcessed(restoreProcessed), saveLogs(restoreLogs)])
    throw err
  }

  // Fase 3: auto-matching
  const [freshHot, stores] = await Promise.all([loadHotState(), getStores()])
  freshHot.currentPhase = 'auto-matching'
  await saveHotState(freshHot)

  const { matched, errors } = await runAutoMatchCore(stores, triggeredBy)

  return NextResponse.json({ success: true, ...cycleResult, autoMatched: matched, autoMatchErrors: errors.length })
}

export async function GET() {
  try {
    return await runFullCycle('cron')
  } catch (err) {
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      hot.currentPhase = 'idle'
      appendError(logs, 'reevaluar', 'error', `Error inesperado en ciclo automático (GET): ${String(err)}`)
      await Promise.all([saveHotState(hot), saveLogs(logs)])
    } catch { /* no bloquear si falla el logging */ }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  try {
    return await runFullCycle('manual_button')
  } catch (err) {
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      hot.currentPhase = 'idle'
      appendError(logs, 'reevaluar', 'error', `Error inesperado en ciclo manual (POST): ${String(err)}`)
      await Promise.all([saveHotState(hot), saveLogs(logs)])
    } catch { /* no bloquear si falla el logging */ }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
