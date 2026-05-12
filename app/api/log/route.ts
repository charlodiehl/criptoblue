import { NextResponse } from 'next/server'
import {
  loadHotState, loadLogs, saveLogs, appendActivity,
  loadArchivedRegistroLog, saveArchivedRegistroLog,
  getAvailableLogMonths, getCurrentLogMonthKey,
} from '@/lib/storage'
import { audit } from '@/lib/audit'

// PATCH: edita campos de una entrada, o marca múltiples entradas como copiadas
export async function PATCH(request: Request) {
  try {
    const body = await request.json()

    // Acción bulk: marcar entradas como copiadas
    if (body.action === 'mark_copied') {
      const { timestamps, month } = body as { timestamps: string[]; month?: string }
      if (!Array.isArray(timestamps) || timestamps.length === 0)
        return NextResponse.json({ error: 'timestamps requerido' }, { status: 400 })

      const currentMonth = getCurrentLogMonthKey()
      const nowISO = new Date().toISOString()

      if (month && month !== currentMonth) {
        // Entradas de un mes archivado
        const archived = await loadArchivedRegistroLog(month)
        const tsSet = new Set(timestamps)
        const updated = archived.map(e => tsSet.has(e.timestamp) ? { ...e, copiedAt: nowISO } : e)
        await saveArchivedRegistroLog(month, updated)
      } else {
        // Entradas del mes actual
        const logs = await loadLogs()
        const tsSet = new Set(timestamps)
        logs.registroLog = logs.registroLog.map(e =>
          tsSet.has(e.timestamp) ? { ...e, copiedAt: nowISO } : e
        )
        await saveLogs(logs)
      }

      audit({ category: 'user_action', action: 'registro.mark_copied', result: 'success', actor: 'human', component: 'api/log', message: `${timestamps.length} entradas copiadas` })
      return NextResponse.json({ success: true })
    }

    // Acción individual: editar campos de nombre, CUIT, orden, tienda
    const { timestamp, customerName, cuit, orderNumber, storeName } = body
    if (!timestamp) return NextResponse.json({ error: 'timestamp requerido' }, { status: 400 })

    function applyEdit(entry: ReturnType<typeof Object.assign>) {
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
      return entry
    }

    // Buscar en mes actual primero
    const logs = await loadLogs()
    const idx = logs.registroLog.findIndex(e => e.timestamp === timestamp)

    if (idx !== -1) {
      logs.registroLog[idx] = applyEdit({ ...logs.registroLog[idx] })
      appendActivity(logs, 'human', 'registro_editado', { timestamp, customerName, cuit, orderNumber, storeName })
      await saveLogs(logs)
    } else {
      // Buscar en archivos de meses anteriores
      const months = await getAvailableLogMonths()
      let found = false
      for (const month of [...months].reverse()) {
        const archived = await loadArchivedRegistroLog(month)
        const archIdx = archived.findIndex(e => e.timestamp === timestamp)
        if (archIdx !== -1) {
          archived[archIdx] = applyEdit({ ...archived[archIdx] })
          await saveArchivedRegistroLog(month, archived)
          found = true
          break
        }
      }
      if (!found) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })
    }

    audit({ category: 'user_action', action: 'registro.edit', result: 'success', actor: 'human', component: 'api/log', message: `Entrada editada: ${timestamp}`, meta: { customerName, cuit, orderNumber, storeName } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: devuelve registroLog para el frontend
// Sin parámetros → mes actual. Con ?month=YYYY-MM → mes archivado.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')
    const currentMonth = getCurrentLogMonthKey()

    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

    let entries
    if (month && month !== currentMonth) {
      entries = await loadArchivedRegistroLog(month)
    } else {
      entries = logs.registroLog ?? []
    }

    return NextResponse.json({
      entries: entries.filter((e: { hidden?: boolean }) => !e.hidden),
      recentMatches: hot.recentMatches ?? [],
      currentMonth,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
