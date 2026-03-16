import { NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

// GET: devuelve matchLog + recentMatches para el frontend
export async function GET() {
  try {
    const state = await loadState()
    return NextResponse.json({
      entries: state.matchLog,
      recentMatches: state.recentMatches || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE: borra el registro manualmente (no toca recentMatches ni pagos)
// IMPORTANTE: antes de borrar, preservar IDs confirmados/descartados en externallyMarkedPayments
// para que el ciclo de reevaluar no los re-agregue a la cola de emparejamiento.
export async function DELETE() {
  try {
    const state = await loadState()

    // Extraer IDs de pagos ya procesados del log antes de borrarlo
    const confirmedIds = state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    // Agregar a externallyMarkedPayments para que cycle.ts los siga ignorando
    const existing = new Set(state.externallyMarkedPayments || [])
    for (const id of confirmedIds) {
      existing.add(id)
    }
    state.externallyMarkedPayments = Array.from(existing)

    const entryCount = state.matchLog.length
    state.matchLog = []

    appendActivity(state, 'human', 'registro_borrado', { entradasEliminadas: entryCount })

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
