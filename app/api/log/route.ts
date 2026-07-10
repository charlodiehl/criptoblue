import { NextResponse } from 'next/server'
import { loadHotState, loadLogs, saveLogs, appendActivity, notifyKeyUpdate } from '@/lib/storage'
import { queryRegistro, queryRegistroPaged, queryRegistroUncopied, updateRegistroByTimestamp, markRegistroCopied, claimRegistroUncopied, unclaimRegistro } from '@/lib/registro'
import type { RegistroSortKey } from '@/lib/registro'
import { audit } from '@/lib/audit'

// PATCH: edita campos de una entrada, o reclama/devuelve entradas para copiar
export async function PATCH(request: Request) {
  try {
    const body = await request.json()

    // Reclamo atómico para "Copiar nuevos": marca y devuelve en una sola operación,
    // así dos admins simultáneos no se llevan las mismas entradas. El que llega
    // segundo recibe solo lo que el primero no alcanzó a reclamar (o nada).
    if (body.action === 'claim_copy') {
      const { search, month, dateFrom, dateTo } = body as {
        search?: string; month?: string; dateFrom?: string; dateTo?: string
      }
      const { entries, claimIds } = await claimRegistroUncopied({ search, month, dateFrom, dateTo })

      if (claimIds.length) {
        // registro_log no vive en kv_store, así que no dispara Realtime por sí solo:
        // hay que avisar a mano para que los otros admins vean el contador bajar.
        notifyKeyUpdate('criptoblue:logs').catch(() => {})
        audit({ category: 'user_action', action: 'registro.claim_copy', result: 'success', actor: 'human', component: 'api/log', message: `${claimIds.length} entradas reclamadas para copiar` })
      }
      return NextResponse.json({ entries, claimIds })
    }

    // Devuelve a "sin copiar" lo reclamado: el navegador no pudo escribir el portapapeles.
    if (body.action === 'unclaim_copy') {
      const { ids } = body as { ids: number[] }
      if (!Array.isArray(ids) || ids.length === 0)
        return NextResponse.json({ error: 'ids requerido' }, { status: 400 })

      await unclaimRegistro(ids)
      notifyKeyUpdate('criptoblue:logs').catch(() => {})
      audit({ category: 'user_action', action: 'registro.unclaim_copy', result: 'success', actor: 'human', component: 'api/log', message: `${ids.length} entradas devueltas a sin copiar` })
      return NextResponse.json({ success: true })
    }

    // OBSOLETO: solo para una pestaña vieja abierta durante el deploy. Ver markRegistroCopied.
    if (body.action === 'mark_copied') {
      const { timestamps } = body as { timestamps: string[] }
      if (!Array.isArray(timestamps) || timestamps.length === 0)
        return NextResponse.json({ error: 'timestamps requerido' }, { status: 400 })

      await markRegistroCopied(timestamps)
      notifyKeyUpdate('criptoblue:logs').catch(() => {})

      audit({ category: 'user_action', action: 'registro.mark_copied', result: 'success', actor: 'human', component: 'api/log', message: `${timestamps.length} entradas copiadas (camino obsoleto)` })
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
const VALID_SORT_KEYS: RegistroSortKey[] = ['fecha', 'monto', 'cuit', 'nombre', 'tienda', 'orden', 'billetera']

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const currentMonth = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
    const mode = searchParams.get('mode')

    // Filtros compartidos por los modos paged/copy
    const search = searchParams.get('q') ?? undefined
    const monthParam = searchParams.get('month') ?? undefined
    const dateFrom = searchParams.get('from') ?? undefined
    const dateTo = searchParams.get('to') ?? undefined

    // Modo "copy": todas las entradas sin copiar que cumplen los filtros (para "Copiar nuevos")
    if (mode === 'copy') {
      const entries = await queryRegistroUncopied({ search, month: monthParam, dateFrom, dateTo })
      return NextResponse.json({ entries })
    }

    // Modo "paged": paginación de servidor (pestaña Registro)
    if (searchParams.has('paged')) {
      const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
      const pageSize = Number(searchParams.get('pageSize') ?? '100') || 100
      const sortRaw = searchParams.get('sort') as RegistroSortKey | null
      const sortKey = sortRaw && VALID_SORT_KEYS.includes(sortRaw) ? sortRaw : 'fecha'
      const sortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc'

      const result = await queryRegistroPaged({
        page, pageSize, search, month: monthParam, dateFrom, dateTo, sortKey, sortDir,
      })
      return NextResponse.json({ ...result, currentMonth })
    }

    // Modo legacy (sin params): mes actual + recentMatches — lo consume app/page.tsx
    // para derivar órdenes/pagos de las últimas 48hs y los IDs macheados.
    const month = monthParam || currentMonth
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
