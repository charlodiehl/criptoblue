import { NextResponse } from 'next/server'
import { loadHotState, getStores } from '@/lib/storage'
import { runAutoMatchCore } from '@/lib/auto-match-runner'
import { porCadaUnidad } from '@/lib/unidad'
import { requireUnidad, setUnidad } from '@/lib/auth/server'

export const maxDuration = 60

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

// Pre-checks antes de correr auto-match (#2: delega a runAutoMatchCore).
// Devuelve datos planos (no NextResponse) para poder correrlo una vez por unidad.
async function runAutoMatch(triggeredBy: 'cron' | 'manual_button') {
  const hot = await loadHotState()

  const lastSync = hot.lastMPCheck ? new Date(hot.lastMPCheck).getTime() : 0
  const lastRun  = hot.lastAutoMatchAt ? new Date(hot.lastAutoMatchAt).getTime() : 0
  const now = Date.now()

  if (lastRun > lastSync) {
    return { skipped: true, reason: 'already_ran_after_sync', lastRun: hot.lastAutoMatchAt, lastSync: hot.lastMPCheck }
  }
  if (lastSync === 0 || (now - lastSync) < 30 * 1000) {
    return { skipped: true, reason: 'sync_too_recent_or_never', msSinceSync: now - lastSync }
  }

  const stores = await getStores()
  const { matched, errors } = await runAutoMatchCore(stores, triggeredBy)

  console.log(`[auto-match-run] matched: ${matched}, errors: ${errors.length}`)
  return { success: true, matched, errors: errors.length > 0 ? errors : undefined }
}

// GET — disparado por el cron de Vercel. Una pasada por cada unidad de negocio.
export async function GET() {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ skipped: true, reason: 'cron disabled on non-production deployments' })
  }

  try {
    const porUnidad = await porCadaUnidad(() => runAutoMatch('cron'))
    return NextResponse.json({ porUnidad })
  } catch (err) {
    console.error('[auto-match-run] fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — disparo manual desde el botón ⚡ del browser. Solo la unidad de quien lo apretó.
export async function POST() {
  const sesion = await requireUnidad()
  if ('error' in sesion) return sesion.error
  setUnidad(sesion.unidad)
  try {
    return NextResponse.json(await runAutoMatch('manual_button'))
  } catch (err) {
    console.error('[auto-match-run] fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
