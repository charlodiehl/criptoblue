import { NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

// PATCH: edita campos de nombre y CUIT de una entrada del registro (solo esos dos campos)
export async function PATCH(request: Request) {
  try {
    const { timestamp, customerName, cuit, orderNumber, storeName } = await request.json()
    if (!timestamp) return NextResponse.json({ error: 'timestamp requerido' }, { status: 400 })

    const state = await loadState()
    const idx = state.matchLog.findIndex(e => e.timestamp === timestamp)
    if (idx === -1) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })

    const entry = state.matchLog[idx]

    if (customerName !== undefined) {
      entry.customerName = customerName
      if (entry.payment) entry.payment.nombrePagador = customerName
    }
    if (cuit !== undefined) {
      if (entry.payment) entry.payment.cuitPagador = cuit
    }
    if (orderNumber !== undefined) {
      entry.orderNumber = orderNumber
      if (entry.order) entry.order.orderNumber = orderNumber
    }
    if (storeName !== undefined) {
      entry.storeName = storeName
      if (entry.order) entry.order.storeName = storeName
    }

    state.matchLog[idx] = entry
    appendActivity(state, 'human', 'registro_editado', { timestamp, customerName, cuit, orderNumber, storeName })
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

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
