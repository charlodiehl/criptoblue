import { NextResponse } from 'next/server'
import { loadHotState, loadLogs, saveLogs, appendActivity } from '@/lib/storage'
import { queryRegistro, updateRegistroByTimestamp, markRegistroCopied } from '@/lib/registro'
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

      await markRegistroCopied(timestamps)

      audit({ category: 'user_action', action: 'registro.mark_copied', result: 'success', actor: 'human', component: 'api/log', message: `${timestamps.length} entradas copiadas` })
      return NextResponse.json({ success: true })
    }

    // Acción individual: editar campos de nombre, CUIT, orden, tienda
    const { timestamp, customerName, cuit, orderNumber, storeName } = body
    if (!timestamp) return NextResponse.json({ error: 'timestamp requerido' }, { status: 400 })

    const ok = await updateRegistroByTimestamp(timestamp, { customerName, cuit, orderNumber, storeName })
    if (!ok) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })

    // Registrar la edición en el activityLog
    const logs = await loadLogs()
    appendActivity(logs, 'human', 'registro_editado', { timestamp, customerName, cuit, orderNumber, storeName })
    await saveLogs(logs)

    audit({ category: 'user_action', action: 'registro.edit', result: 'success', actor: 'human', component: 'api/log', message: `Entrada editada: ${timestamp}`, meta: { customerName, cuit, orderNumber, storeName } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: devuelve el registro de un mes para el frontend (que filtra/ordena/pagina
// del lado del cliente). Sin ?month se asume el mes actual (horario Argentina).
// Límite alto para no truncar la vista — un mes está acotado a cientos de entradas.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const currentMonth = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
    const month = searchParams.get('month') || currentMonth
    const limit = Number(searchParams.get('limit') ?? '5000')
    const offset = Number(searchParams.get('offset') ?? '0')

    const [hot, result] = await Promise.all([
      loadHotState(),
      queryRegistro({ month, limit, offset }),
    ])

    return NextResponse.json({
      entries: result.entries,
      total: result.total,
      hasMore: result.hasMore,
      recentMatches: hot.recentMatches ?? [],
      currentMonth,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
