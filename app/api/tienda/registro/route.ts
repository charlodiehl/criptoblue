import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { queryRegistroByStoreDay, searchRegistroByStore } from '@/lib/registro'
import { getMovimientosPorRegistroIds } from '@/lib/balance'
import { getComisiones, comisionTienda } from '@/lib/comisiones'
import { billeteraLabel } from '@/lib/utils'

// GET /api/tienda/registro?fecha=YYYY-MM-DD[&storeId=]   → órdenes acreditadas ese día
//    ó  ?q=<texto>[&storeId=]                            → búsqueda en todo el registro
//
// Órdenes de la tienda ya cruzadas server-side con su movimiento de balance para
// traer la cotización USDT usada. Devuelve filas listas para la tabla.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const q = (req.nextUrl.searchParams.get('q') || '').trim()
    const fecha = req.nextUrl.searchParams.get('fecha') || ''
    if (!q && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: 'Falta "fecha" (YYYY-MM-DD) o "q" (búsqueda)' }, { status: 400 })
    }

    const entradas = q
      ? await searchRegistroByStore(storeId, q)
      : await queryRegistroByStoreDay(storeId, fecha)
    const movimientos = await getMovimientosPorRegistroIds(entradas.map(e => e.registroId))
    const comisionPct = comisionTienda(await getComisiones(), storeId)

    const rows = entradas.map(({ registroId, entry }) => {
      const mov = movimientos.get(registroId)
      const monto = entry.amount ?? entry.payment?.monto ?? 0
      return {
        registroId,   // lo necesita el admin para editar la entrada
        // Fecha y hora del PAGO (la que trajo la planilla), no la del emparejamiento.
        fecha: entry.paymentReceivedAt || entry.payment?.fechaPago || entry.timestamp,
        monto,
        comision: monto * comisionPct / 100,   // comisión ARS de esta orden
        cuit: entry.payment?.cuitPagador || entry.cuitPagador || '',
        nombre: entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || '',
        orderNumber: entry.orderNumber || entry.order?.orderNumber || '',
        billetera: billeteraLabel(entry.payment?.source),
        usdtRate: mov?.usdtRate ?? null,   // null = cotización pendiente
        usdt: mov?.usdt ?? null,           // ya SIGNADO (ingreso → positivo)
      }
    })

    // Ordenadas por fecha de pago (la consulta viene por ts de emparejamiento).
    rows.sort((a, b) => (new Date(b.fecha).getTime() || 0) - (new Date(a.fecha).getTime() || 0))

    return NextResponse.json({ fecha, comisionPct, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
