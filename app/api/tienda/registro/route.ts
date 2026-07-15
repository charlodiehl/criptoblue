import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { queryRegistroByStoreDay, searchRegistroByStore } from '@/lib/registro'
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
        comision: comisionTiendaSobre(monto, comisionPct),   // comisión ARS de esta orden (grossed-up)
        cuit: entry.payment?.cuitPagador || entry.cuitPagador || '',
        nombre: entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || '',
        orderNumber: entry.orderNumber || entry.order?.orderNumber || '',
        billetera: billeteraLabel(entry.payment?.source),
        hechoPor: entry.hechoPor ?? null,   // email del admin que lo cargó/editó a mano (null = automático)
        // false = la orden no tiene movimiento de balance (se le quitó a propósito para
        // que no duplique el saldo inicial). La UI muestra "No suma", no "Pendiente".
        enSaldo: !!mov,
        usdtRate: mov?.usdtRate ?? null,   // null = cotización pendiente
        // Equivalente USDT NETO de esta orden: el bruto (mov.usdt) menos la comisión
        // en USDT, con la MISMA fórmula grossed-up que usa el saldo (lib/balance.ts).
        // Así la suma de la columna cuadra con el "Saldo en USDT". null si la
        // cotización está pendiente. mov.usdt viene SIGNADO (ingreso → positivo).
        usdt: mov?.usdt != null ? mov.usdt - comisionTiendaSobre(mov.usdt, comisionPct) : null,
      }
    })

    // Ordenadas por fecha de pago (la consulta viene por ts de emparejamiento).
    rows.sort((a, b) => (new Date(b.fecha).getTime() || 0) - (new Date(a.fecha).getTime() || 0))

    return NextResponse.json({ fecha, comisionPct, rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
