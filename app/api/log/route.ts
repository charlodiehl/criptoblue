import { NextResponse } from 'next/server'
import { loadHotState, loadLogs, saveLogs, appendActivity } from '@/lib/storage'
import { audit } from '@/lib/audit'

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
      audit({ category: 'user_action', action: 'registro.mark_copied', result: 'success', actor: 'human', component: 'api/log', message: `${timestamps.length} entradas copiadas` })
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
    audit({ category: 'user_action', action: 'registro.edit', result: 'success', actor: 'human', component: 'api/log', message: `Entrada editada: ${timestamp}`, meta: { customerName, cuit, orderNumber, storeName } })
    await saveLogs(logs)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: devuelve registroLog + recentMatches para el frontend
// Entradas con hidden=true (del antiguo botón "Borrar") se mantienen ocultas.
// Las nuevas nunca tendrán hidden — el registro es permanente.
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
