import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { queryRegistroByStoreDay, searchRegistroByStore, querySaldosPersonalizadosByStoreDay } from '@/lib/registro'
import { getMovimientosPorRegistroIds } from '@/lib/balance'
import { getComisiones, comisionTienda, comisionTiendaSobre } from '@/lib/comisiones'
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
    // Saldos personalizados del día (solo en la vista por día, no en la búsqueda):
    // van en su propia tabla con formato de orden.
    const entradasSP = q ? [] : await querySaldosPersonalizadosByStoreDay(storeId, fecha)
    const movimientos = await getMovimientosPorRegistroIds(
      [...entradas, ...entradasSP].map(e => e.registroId),
    )
    const comisionPct = comisionTienda(await getComisiones(), storeId)

    // Arma una fila con formato de orden (monto, comisión grossed-up, cotización y
    // USDT neto) a partir de una entrada del registro cruzada con su movimiento.
    const filaOrden = ({ registroId, entry }: { registroId: number; entry: typeof entradas[number]['entry'] }) => {
      const mov = movimientos.get(registroId)
      const monto = entry.amount ?? entry.payment?.monto ?? 0
      return {
        registroId,
        // id del movimiento de balance: el saldo personalizado se edita como movimiento.
        movId: mov?.id ?? null,
        fecha: entry.paymentReceivedAt || entry.payment?.fechaPago || entry.timestamp,
        monto,
        comision: comisionTiendaSobre(monto, comisionPct),
        cuit: entry.payment?.cuitPagador || entry.cuitPagador || '',
        nombre: entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || '',
        orderNumber: entry.orderNumber || entry.order?.orderNumber || '',
        billetera: billeteraLabel(entry.payment?.source),
        hechoPor: entry.hechoPor ?? null,
        enSaldo: !!mov,
        usdtRate: mov?.usdtRate ?? null,
        usdt: mov?.usdt != null ? mov.usdt - comisionTiendaSobre(mov.usdt, comisionPct) : null,
      }
    }

    const rows = entradas.map(filaOrden)
    // Saldos personalizados con el mismo formato de orden (comisión, USDT neto). Llevan
    // además movId, porque se editan como movimiento (sincroniza saldo + billetera).
    const saldosPersonalizados = entradasSP.map(filaOrden)

    // Ordenadas por fecha de pago (la consulta viene por ts de emparejamiento).
    const porFecha = (a: { fecha: string }, b: { fecha: string }) =>
      (new Date(b.fecha).getTime() || 0) - (new Date(a.fecha).getTime() || 0)
    rows.sort(porFecha)
    saldosPersonalizados.sort(porFecha)

    return NextResponse.json({ fecha, comisionPct, rows, saldosPersonalizados })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
