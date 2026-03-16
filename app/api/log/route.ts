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
// IMPORTANTE: antes de borrar, preservar IDs en las listas correctas para que cycle.ts
// no los re-agregue a la cola de emparejamiento tras un reevaluar.
// - manual_paid / auto_paid → retainedPaymentIds (protección en backend, sin efecto en badges)
// - dismissed → externallyMarkedPayments (protección en backend; mantiene semántica "No es de tiendas")
export async function DELETE() {
  try {
    const state = await loadState()

    // Pagos confirmados (matched): van a retainedPaymentIds, no tocan el badge del frontend
    const matchedIds = state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    const existingRetained = new Set(state.retainedPaymentIds || [])
    for (const id of matchedIds) {
      existingRetained.add(id)
    }
    state.retainedPaymentIds = Array.from(existingRetained)

    // Pagos descartados: van a externallyMarkedPayments (su semántica original)
    const dismissedIds = state.matchLog
      .filter(e => e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    const existingExternal = new Set(state.externallyMarkedPayments || [])
    for (const id of dismissedIds) {
      existingExternal.add(id)
    }
    state.externallyMarkedPayments = Array.from(existingExternal)

    const entryCount = state.matchLog.length
    state.matchLog = []

    appendActivity(state, 'human', 'registro_borrado', { entradasEliminadas: entryCount })

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
