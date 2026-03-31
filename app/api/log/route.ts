import { NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity } from '@/lib/storage'

// PATCH: edita campos de una entrada, o marca múltiples entradas como copiadas
export async function PATCH(request: Request) {
  try {
    const body = await request.json()

    // Acción bulk: marcar entradas como copiadas
    if (body.action === 'mark_copied') {
      const { timestamps } = body as { timestamps: string[] }
      if (!Array.isArray(timestamps) || timestamps.length === 0)
        return NextResponse.json({ error: 'timestamps requerido' }, { status: 400 })

      const logs = await loadLogs()
      const tsSet = new Set(timestamps)
      const nowISO = new Date().toISOString()
      logs.registroLog = logs.registroLog.map(e =>
        tsSet.has(e.timestamp) ? { ...e, copiedAt: nowISO } : e
      )
      await saveLogs(logs)
      return NextResponse.json({ success: true })
    }

    // Acción individual: editar campos de nombre, CUIT, orden, tienda
    const { timestamp, customerName, cuit, orderNumber, storeName } = body
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

    // Solo ocultar entradas ya copiadas — las nuevas (sin copiedAt) se conservan visibles
    const toHide = logs.registroLog.filter(e => !e.hidden && e.copiedAt)
    const entryCount = toHide.length
    const toHideTs = new Set(toHide.map(e => e.timestamp))
    logs.registroLog = logs.registroLog.map(e =>
      toHideTs.has(e.timestamp) ? { ...e, hidden: true } : e
    )

    appendActivity(logs, 'human', 'registro_borrado', { entradasEliminadas: entryCount })

    await Promise.all([saveHotState(hot), saveLogs(logs)])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
