import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { detectColumns, normalizeRow, normalizeHeader, pagoFirma, buildSigSet } from '@/lib/cargar-pagos'
import { loadHotState } from '@/lib/storage'
import { getRegistroPaymentsBySource } from '@/lib/registro'
import { requireUnidad } from '@/lib/auth/server'

const LACAR_SOURCE = 'lacar'

export const runtime = 'nodejs'

// POST multipart { file } → parsea la planilla, detecta columnas por su header y
// devuelve la vista previa de los pagos que se cargarían (sin escribir nada).
export async function POST(req: NextRequest) {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = new ExcelJS.Workbook()
    const isCsv = /\.csv$/i.test(file.name)
    if (isCsv) {
      // exceljs.csv.read espera un stream; usamos un Readable desde el buffer
      const { Readable } = await import('stream')
      await wb.csv.read(Readable.from(buf))
    } else {
      // cast: exceljs empaqueta su propia copia de @types/node, su Buffer difiere del nuestro
      await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0])
    }

    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'El archivo no tiene hojas' }, { status: 400 })

    const colCount = Math.max(ws.columnCount, 1)
    const readRow = (row: ExcelJS.Row): unknown[] => {
      const a: unknown[] = []
      for (let c = 1; c <= colCount; c++) a.push(cellVal(row.getCell(c).value))
      return a
    }

    // Primera fila NO vacía = header
    const all: unknown[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => { all.push(readRow(row)) })
    if (all.length < 2) {
      return NextResponse.json({ error: 'El archivo necesita una fila de encabezados y al menos una fila de datos' }, { status: 400 })
    }

    const headers = all[0].map(h => (h ?? '').toString())
    const dataRows = all.slice(1)
    const { mapping, headerCampo } = detectColumns(headers)

    const todas = dataRows
      .map((r, i) => normalizeRow(r, mapping, i + 2)) // +2: fila 1 = header
      .filter(p => !(p.monto === null && !p.nombre && !p.cuit && !p.email)) // descartar filas totalmente vacías

    // Un pago válido = importe POSITIVO + fecha. Los negativos son retiros/comisiones
    // de plataforma, y los positivos sin fecha suelen ser filas de total/resumen del
    // export → ambos se descartan.
    const validos = todas.filter(p => p.monto !== null && p.monto > 0 && p.fecha)
    const retiros = todas.filter(p => p.monto !== null && p.monto < 0).length
    const sinFecha = todas.filter(p => p.monto !== null && p.monto > 0 && !p.fecha).length
    const sinMonto = todas.filter(p => p.monto === null).length

    // Dedup: omitir los pagos que ya están en la app (cola + registro), por firma
    // (fecha+hora, nombre, monto). Solo se muestran/cargan los NUEVOS.
    const [hot, registroLacar] = await Promise.all([loadHotState(), getRegistroPaymentsBySource(LACAR_SOURCE)])
    const existentes = buildSigSet(hot.unmatchedPayments, registroLacar, LACAR_SOURCE)
    const vistos = new Set<string>()
    const payments: typeof validos = []
    let yaCargados = 0
    for (const p of validos) {
      const firma = pagoFirma(p.monto, p.fecha, p.nombre)
      if (existentes.has(firma) || vistos.has(firma)) { yaCargados++; continue }
      vistos.add(firma)
      payments.push(p)
    }

    const unmapped = headers.filter((h, i) => headerCampo[i] === null && normalizeHeader(h))

    return NextResponse.json({
      headers,
      mapping,
      headerCampo,
      unmapped,
      totalFilas: dataRows.length,
      payments,
      yaCargados,
      retiros,
      sinFecha,
      sinMonto,
    })
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${String(err)}` }, { status: 500 })
  }
}

// Normaliza el valor de una celda de exceljs (Date, fórmula, hyperlink, rich text).
function cellVal(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return o.result
    if ('text' in o) return o.text
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map(t => t.text).join('')
    if ('hyperlink' in o) return o.text ?? o.hyperlink
  }
  return v
}
