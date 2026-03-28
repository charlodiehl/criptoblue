import { NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity } from '@/lib/storage'

// PATCH: edita campos de nombre y CUIT de una entrada del registro (solo esos dos campos)
export async function PATCH(request: Request) {
  try {
    const { timestamp, customerName, cuit, orderNumber, storeName } = await request.json()
    if (!timestamp) return NextResponse.json({ error: 'timestamp requerido' }, { status: 400 })

    const logs = await loadLogs()
    const idx = logs.registroLog.findIndex(e => e.timestamp === timestamp)
    if (idx === -1) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })

    const entry = logs.registroLog[idx]

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

    logs.registroLog[idx] = entry
    appendActivity(logs, 'human', 'registro_editado', { timestamp, customerName, cuit, orderNumber, storeName })
    await saveLogs(logs)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: devuelve registroLog + recentMatches para el frontend (excluye entradas ocultas)
export async function GET() {
  try {
    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
    return NextResponse.json({
      entries: (logs.registroLog ?? []).filter(e => !e.hidden),
      recentMatches: hot.recentMatches ?? [],
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
    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

    const nowISO = new Date().toISOString()

    // Pagos confirmados (matched): van a retainedPaymentIds para protección en backend
    const matchedIds = logs.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    const existingRetained = new Set(hot.retainedPaymentIds ?? [])
    for (const id of matchedIds) {
      existingRetained.add(id)
    }
    hot.retainedPaymentIds = Array.from(existingRetained)

    // Pagos descartados: van a externallyMarkedPayments
    const dismissedIds = logs.registroLog
      .filter(e => e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id)

    for (const id of dismissedIds) {
      if (!hot.externallyMarkedPayments.some(e => e.id === id)) {
        hot.externallyMarkedPayments.push({ id, markedAt: nowISO })
      }
    }

    // Marcar como ocultas en lugar de borrar — se conservan en Supabase por 30 días
    const visibleEntries = logs.registroLog.filter(e => !e.hidden)
    const entryCount = visibleEntries.length
    logs.registroLog = logs.registroLog.map(e => ({ ...e, hidden: true }))

    appendActivity(logs, 'human', 'registro_borrado', { entradasEliminadas: entryCount })

    await Promise.all([saveHotState(hot), saveLogs(logs)])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
