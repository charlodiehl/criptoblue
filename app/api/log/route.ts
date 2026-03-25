import { NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

// PATCH: edita campos de nombre y CUIT de una entrada del registro (solo esos dos campos)
export async function PATCH(request: Request) {
  try {
    const { timestamp, customerName, cuit, orderNumber, storeName } = await request.json()
    if (!timestamp) return NextResponse.json({ error: 'timestamp requerido' }, { status: 400 })

    const state = await loadState()
    const idx = state.registroLog.findIndex(e => e.timestamp === timestamp)
    if (idx === -1) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })

    const entry = state.registroLog[idx]

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

    state.registroLog[idx] = entry
    appendActivity(state, 'human', 'registro_editado', { timestamp, customerName, cuit, orderNumber, storeName })
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: devuelve registroLog + recentMatches para el frontend
export async function GET() {
  try {
    const state = await loadState()
    return NextResponse.json({
      entries: state.registroLog,
      recentMatches: state.recentMatches || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE: borra el registro visualmente (limpia registroLog)
// IMPORTANTE: NO toca persistedMonthStats (las tarjetas son independientes)
// Preserva IDs en retainedPaymentIds y externallyMarkedPayments para que cycle.ts
// no re-agregue esos pagos a la cola de emparejamiento.
export async function DELETE() {
  try {
    const state = await loadState()

    const now = new Date()
    const nowISO = now.toISOString()

    // Pagos confirmados (matched): van a retainedPaymentIds para protección en backend
    const matchedIds = state.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    const existingRetained = new Set(state.retainedPaymentIds || [])
    for (const id of matchedIds) {
      existingRetained.add(id)
    }
    state.retainedPaymentIds = Array.from(existingRetained)

    // Pagos descartados: van a externallyMarkedPayments
    const dismissedIds = state.registroLog
      .filter(e => e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    for (const id of dismissedIds) {
      if (!state.externallyMarkedPayments.some(e => e.id === id)) {
        state.externallyMarkedPayments.push({ id, markedAt: nowISO })
      }
    }

    const entryCount = state.registroLog.length
    state.registroLog = []

    appendActivity(state, 'human', 'registro_borrado', { entradasEliminadas: entryCount })

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
