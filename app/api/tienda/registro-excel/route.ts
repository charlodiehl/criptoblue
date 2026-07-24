import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireUser, resolveStoreScope, setUnidad } from '@/lib/auth/server'
import { queryRegistroByStoreRango } from '@/lib/registro'
import { getMovimientosPorRegistroIds, getMovimientosExtractoRango } from '@/lib/balance'
import { getComisiones, comisionTiendaSobre, comisionTiendaEnFecha, diaART } from '@/lib/comisiones'
import { getStores } from '@/lib/storage'

export const runtime = 'nodejs'

// GET /api/tienda/registro-excel?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&storeId=]
//
// Descarga un Excel con TODAS las órdenes emparejadas de la tienda en el rango, en una
// hoja "Ventas". Mismas columnas y valores que la tabla del registro: la comisión se
// calcula con el % vigente del día de cada orden (respeta los tramos de comisión).

// 'D/M/YYYY HH:mm:ss' en horario Argentina (UTC-3), igual que la tabla en pantalla.
function fechaHoraART(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = new Date(t - 3 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const desde = req.nextUrl.searchParams.get('desde') || ''
    const hasta = req.nextUrl.searchParams.get('hasta') || ''
    const re = /^\d{4}-\d{2}-\d{2}$/
    if (!re.test(desde) || !re.test(hasta)) {
      return NextResponse.json({ error: 'Rango inválido: se requieren desde y hasta (YYYY-MM-DD)' }, { status: 400 })
    }
    if (desde > hasta) {
      return NextResponse.json({ error: 'La fecha "desde" no puede ser posterior a "hasta"' }, { status: 400 })
    }

    const [entradas, cfg, stores] = await Promise.all([
      queryRegistroByStoreRango(storeId, desde, hasta),
      getComisiones(),
      getStores(),
    ])
    const movimientos = await getMovimientosPorRegistroIds(entradas.map(e => e.registroId))

    // Fila por orden — mismos valores que la tabla (comisión y USDT neto con el % del día).
    const filas = entradas.map(({ registroId, entry }) => {
      const mov = movimientos.get(registroId)
      const monto = entry.amount ?? entry.payment?.monto ?? 0
      // La comisión se ancla al día del emparejamiento (ts), igual que el saldo del día.
      const pct = comisionTiendaEnFecha(cfg, storeId, diaART(entry.timestamp))
      const sinCom = mov?.sinComision === true
      const fecha = entry.paymentReceivedAt || entry.payment?.fechaPago || entry.timestamp
      return {
        fecha: fechaHoraART(fecha),
        _ts: new Date(fecha).getTime() || 0,
        monto: Number(monto) || 0,
        comision: sinCom ? 0 : comisionTiendaSobre(Number(monto) || 0, pct),
        cotizacion: mov?.usdtRate ?? null,
        usdt: mov?.usdt == null ? null : (sinCom ? mov.usdt : mov.usdt - comisionTiendaSobre(mov.usdt, pct)),
        cuit: entry.payment?.cuitPagador || entry.cuitPagador || '',
        nombre: entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || '',
        orden: entry.orderNumber || entry.order?.orderNumber || '',
      }
    }).sort((a, b) => a._ts - b._ts)   // cronológico

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Ventas')
    ws.columns = [
      { header: 'Fecha y hora', key: 'fecha', width: 22 },
      { header: 'Monto', key: 'monto', width: 15 },
      { header: 'Comisión', key: 'comision', width: 15 },
      { header: 'Cotización USDT', key: 'cotizacion', width: 16 },
      { header: 'Equivalente USDT', key: 'usdt', width: 17 },
      { header: 'CUIT del beneficiario', key: 'cuit', width: 20 },
      { header: 'Nombre del beneficiario', key: 'nombre', width: 30 },
      { header: 'Número de orden', key: 'orden', width: 16 },
    ]
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).alignment = { vertical: 'middle' }
    // Dos decimales, y los negativos con signo menos (no entre paréntesis).
    const N2 = '#,##0.00;-#,##0.00'
    // Signos: las ventas son INGRESOS (monto y USDT positivos) y la comisión es un
    // descuento sobre ellas, así que va en negativo (igual que en pantalla).
    for (const f of filas) {
      ws.addRow({
        fecha: f.fecha,
        monto: Number(f.monto.toFixed(2)),
        comision: f.comision === 0 ? 0 : -Number(f.comision.toFixed(2)),
        cotizacion: f.cotizacion == null ? '' : Number(f.cotizacion.toFixed(2)),
        usdt: f.usdt == null ? '' : Number(f.usdt.toFixed(2)),
        cuit: f.cuit || '',
        nombre: f.nombre || '',
        orden: f.orden ? `#${f.orden}` : '',
      })
    }
    // Formato numérico de las columnas de importes.
    for (const col of ['monto', 'comision', 'cotizacion', 'usdt']) ws.getColumn(col).numFmt = N2

    // ── Hojas "Reembolsos" y "Transferencias" (movimientos que no son órdenes) ──
    const movs = await getMovimientosExtractoRango(storeId, desde, hasta)

    const wsReem = wb.addWorksheet('Reembolsos')
    wsReem.columns = [
      { header: 'Fecha y hora', key: 'fecha', width: 22 },
      { header: 'N° de orden', key: 'orden', width: 16 },
      { header: 'Monto (ARS)', key: 'ars', width: 15 },
      { header: 'Monto (USDT)', key: 'usdt', width: 15 },
      { header: 'Cotización USDT', key: 'cotizacion', width: 16 },
      { header: 'Comprobante', key: 'comprobante', width: 13 },
    ]
    wsReem.getRow(1).font = { bold: true }
    for (const m of movs.filter(m => m.tipo === 'reembolso').sort((a, b) => (new Date(a.fecha).getTime() || 0) - (new Date(b.fecha).getTime() || 0))) {
      wsReem.addRow({
        fecha: fechaHoraART(m.fecha),
        orden: m.orden ? `#${m.orden}` : '',
        ars: m.ars == null ? '' : Number(m.ars.toFixed(2)),
        usdt: Number(m.usdt.toFixed(2)),
        cotizacion: m.cotizacion == null ? '' : Number(m.cotizacion.toFixed(2)),
        comprobante: m.comprobante ? 'Sí' : 'No',
      })
    }
    for (const col of ['ars', 'usdt', 'cotizacion']) wsReem.getColumn(col).numFmt = N2

    const TIPO_LABEL: Record<string, string> = {
      egreso_transferencia: 'Transferencia',
      ajuste: 'Ajuste',
      ingreso_manual: 'Saldo personalizado',
    }
    const wsTransf = wb.addWorksheet('Transferencias')
    wsTransf.columns = [
      { header: 'Fecha y hora', key: 'fecha', width: 22 },
      { header: 'Tipo', key: 'tipo', width: 18 },
      { header: 'Concepto', key: 'concepto', width: 30 },
      { header: 'Monto (ARS)', key: 'ars', width: 15 },
      { header: 'Monto (USDT)', key: 'usdt', width: 15 },
      { header: 'Cotización USDT', key: 'cotizacion', width: 16 },
      { header: 'Comprobante', key: 'comprobante', width: 13 },
    ]
    wsTransf.getRow(1).font = { bold: true }
    for (const m of movs.filter(m => m.tipo !== 'reembolso').sort((a, b) => (new Date(a.fecha).getTime() || 0) - (new Date(b.fecha).getTime() || 0))) {
      wsTransf.addRow({
        fecha: fechaHoraART(m.fecha),
        tipo: TIPO_LABEL[m.tipo] ?? m.tipo,
        concepto: m.concepto,
        ars: m.ars == null ? '' : Number(m.ars.toFixed(2)),
        usdt: Number(m.usdt.toFixed(2)),
        cotizacion: m.cotizacion == null ? '' : Number(m.cotizacion.toFixed(2)),
        comprobante: m.tipo === 'egreso_transferencia' ? (m.comprobante ? 'Sí' : 'No') : '',
      })
    }
    for (const col of ['ars', 'usdt', 'cotizacion']) wsTransf.getColumn(col).numFmt = N2

    const buf = await wb.xlsx.writeBuffer()
    const nombreTienda = (stores[storeId]?.storeName || storeId).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'registro'
    const filename = `registro-${nombreTienda}-${desde}_a_${hasta}.xlsx`
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
