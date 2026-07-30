import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { getExtractoBilleteraRango, getBilleterasOcultas } from '@/lib/billeteras'
import { puedeEnBilletera } from '@/lib/permisos'
import { walletsDeUnidad } from '@/lib/unidad'
import { parseRangoART } from '@/lib/utils'

export const runtime = 'nodejs'
// Un rango largo de la billetera más movida son miles de filas: leer el registro y
// armar el .xlsx puede pasar el techo por defecto. Medido en local: ~4 s por mes.
export const maxDuration = 60

// Etiqueta para el nombre del archivo: "2026-07-30_1435" en hora Argentina.
function sello(ms: number): string {
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', '_').replace(':', '')
}

// GET /api/billetera/registro-excel?wallet=<w>&desde=<ISO>&hasta=<ISO>
//
// Espejo de /api/tienda/registro-excel, para billeteras: baja el extracto del rango en
// un Excel con tres hojas — Ingresos, Reembolsos y Retiros. El rango es por fecha Y
// hora (una fecha suelta se sigue aceptando y toma el día entero — ver parseRangoART). Mismos valores que la
// pantalla (el pago figura en el día que ENTRÓ, la comisión es la vigente de la
// billetera, y el corte se respeta).
//
// Sirve a las dos superficies, como hace el de tiendas:
//   • admin  → cualquier billetera de SU unidad de negocio
//   • dueño  → solo las que tiene asignadas, y SOLO con el permiso 'ver_saldo':
//     un Excel es plata en la mano, no se puede censurar a medias como en pantalla.

// 'D/M/YYYY HH:mm:ss' en horario Argentina (UTC-3), igual que la tabla en pantalla.
function fechaHoraART(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = new Date(t - 3 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

const ESTADO_LABEL: Record<string, string> = {
  emparejado: 'Emparejado', en_cola: 'Pendiente', reembolsado: 'Reembolsado',
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const pedida = (req.nextUrl.searchParams.get('wallet') || '').trim()

    let wallet: string
    if (auth.user.role === 'admin') {
      if (!pedida || !walletsDeUnidad().includes(pedida)) {
        return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
      }
      wallet = pedida
    } else {
      // Nunca se confía en el cliente: la billetera se valida contra los accesos.
      const scope = resolveWalletScope(auth.user, pedida)
      if (!scope) return NextResponse.json({ error: 'Billetera no autorizada' }, { status: 403 })
      if (!puedeEnBilletera({ role: auth.user.role, permisos: scope.permisos }, 'ver_saldo')) {
        return NextResponse.json({ error: 'No tenés permiso para ver los montos de esta billetera' }, { status: 403 })
      }
      wallet = scope.wallet
    }

    const ocultas = await getBilleterasOcultas()
    if (ocultas.includes(wallet)) return NextResponse.json({ error: 'Billetera no disponible' }, { status: 404 })

    const rango = parseRangoART(
      req.nextUrl.searchParams.get('desde') || '',
      req.nextUrl.searchParams.get('hasta') || '',
    )
    if (!rango) {
      return NextResponse.json({ error: 'Rango inválido: "hasta" tiene que ser posterior a "desde", y el período no puede superar los 400 días' }, { status: 400 })
    }
    const { desdeMs, hastaMs } = rango

    const extracto = await getExtractoBilleteraRango(wallet, desdeMs, hastaMs)
    // "Otras" agrupa pagos de billeteras con nombre libre: se agrega la columna que las
    // distingue, igual que en pantalla. En el resto sería una columna vacía.
    const esOtras = wallet === 'Otras'

    const wb = new ExcelJS.Workbook()
    // Dos decimales, y los negativos con signo menos (no entre paréntesis).
    const N2 = '#,##0.00;-#,##0.00'

    // ── Hoja "Ingresos" ──
    const ws = wb.addWorksheet('Ingresos')
    ws.columns = [
      { header: 'Fecha y hora del pago', key: 'fecha', width: 22 },
      { header: 'Titular', key: 'titular', width: 30 },
      { header: 'CUIT', key: 'cuit', width: 16 },
      { header: 'Tienda', key: 'tienda', width: 24 },
      ...(esOtras ? [{ header: 'Billetera', key: 'detalle', width: 20 }] : []),
      { header: 'Monto (ARS)', key: 'monto', width: 16 },
      { header: `Comisión (${extracto.comisionPct.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%)`, key: 'comision', width: 16 },
      { header: 'Estado', key: 'estado', width: 14 },
    ]
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).alignment = { vertical: 'middle' }
    // Signos: los pagos son INGRESOS (positivos) y la comisión los descuenta, así que
    // va en negativo — misma convención que el Excel de tiendas.
    for (const p of extracto.pagos) {
      ws.addRow({
        fecha: fechaHoraART(p.fecha),
        titular: p.titular || '',
        cuit: p.cuit || '—',
        tienda: p.tienda || '—',
        ...(esOtras ? { detalle: p.detalle || '—' } : {}),
        monto: Number(p.monto.toFixed(2)),
        comision: p.comision === 0 ? 0 : -Number(p.comision.toFixed(2)),
        estado: ESTADO_LABEL[p.estado] ?? p.estado,
      })
    }
    for (const col of ['monto', 'comision']) ws.getColumn(col).numFmt = N2

    // ── Hoja "Reembolsos" ── (siempre en ARS: no hay conversión que mostrar)
    const wsReem = wb.addWorksheet('Reembolsos')
    wsReem.columns = [
      { header: 'Fecha y hora', key: 'fecha', width: 22 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Tienda', key: 'tienda', width: 24 },
      { header: 'Monto (ARS)', key: 'ars', width: 16 },
    ]
    wsReem.getRow(1).font = { bold: true }
    for (const m of extracto.movimientos.filter(m => m.clase === 'reembolso')) {
      wsReem.addRow({
        fecha: fechaHoraART(m.fecha),
        concepto: m.concepto,
        tienda: m.tienda || '—',
        ars: -Number(m.ars.toFixed(2)),   // baja el saldo
      })
    }
    wsReem.getColumn('ars').numFmt = N2

    // ── Hoja "Retiros" ── (incluye el saldo inicial del corte, si cae en el rango)
    const wsRet = wb.addWorksheet('Retiros')
    wsRet.columns = [
      { header: 'Fecha y hora', key: 'fecha', width: 22 },
      { header: 'Tipo', key: 'tipo', width: 16 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'Monto original', key: 'origen', width: 16 },
      { header: 'Cotización', key: 'cotizacion', width: 14 },
      { header: 'Monto (ARS)', key: 'ars', width: 16 },
    ]
    wsRet.getRow(1).font = { bold: true }
    for (const m of extracto.movimientos.filter(m => m.clase !== 'reembolso')) {
      // El ajuste (saldo inicial del corte) SUMA; el retiro resta.
      const esAjuste = m.clase === 'ajuste'
      wsRet.addRow({
        fecha: fechaHoraART(m.fecha),
        tipo: esAjuste ? 'Saldo inicial' : 'Retiro',
        concepto: m.concepto,
        moneda: m.moneda,
        origen: m.montoOrigen == null ? '' : Number(m.montoOrigen.toFixed(2)),
        // Solo hay cotización cuando el retiro se hizo en USD/USDT.
        cotizacion: m.cotizacion == null ? '—' : Number(m.cotizacion.toFixed(2)),
        ars: esAjuste ? Number(m.ars.toFixed(2)) : -Number(m.ars.toFixed(2)),
      })
    }
    for (const col of ['origen', 'cotizacion', 'ars']) wsRet.getColumn(col).numFmt = N2

    const buf = await wb.xlsx.writeBuffer()
    const nombre = wallet.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'billetera'
    const filename = `registro-${nombre}-${sello(desdeMs)}_a_${sello(hastaMs)}.xlsx`
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
