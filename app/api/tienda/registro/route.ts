import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { queryRegistroByStoreDay } from '@/lib/registro'
import { getMovimientosPorRegistroIds } from '@/lib/balance'
import { billeteraLabel } from '@/lib/utils'

// GET /api/tienda/registro?fecha=YYYY-MM-DD[&storeId=]
//
// Órdenes acreditadas de la tienda en ese día (ART), ya cruzadas server-side con
// su movimiento de balance para traer la cotización USDT usada. Devuelve filas
// listas para la tabla (no expone el id del registro).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const fecha = req.nextUrl.searchParams.get('fecha') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: 'Parámetro "fecha" (YYYY-MM-DD) requerido' }, { status: 400 })
    }

    const entradas = await queryRegistroByStoreDay(storeId, fecha)
    const movimientos = await getMovimientosPorRegistroIds(entradas.map(e => e.registroId))

    const rows = entradas.map(({ registroId, entry }) => {
      const mov = movimientos.get(registroId)
      return {
        fecha: entry.timestamp,
        monto: entry.amount ?? entry.payment?.monto ?? 0,
        cuit: entry.payment?.cuitPagador || entry.cuitPagador || '',
        nombre: entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || '',
        orderNumber: entry.orderNumber || entry.order?.orderNumber || '',
        billetera: billeteraLabel(entry.payment?.source),
        usdtRate: mov?.usdtRate ?? null,   // null = cotización pendiente
        usdt: mov?.usdt ?? null,           // ya SIGNADO (ingreso → positivo)
      }
    })

    return NextResponse.json({ fecha, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
