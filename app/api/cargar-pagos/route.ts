import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { getRegistroPaymentsBySource } from '@/lib/registro'
import { pagoFirma, buildSigSet } from '@/lib/cargar-pagos'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { requireUnidad } from '@/lib/auth/server'

export const runtime = 'nodejs'

const LOCK_HOLDER = 'cargar-pagos'
const LACAR_SOURCE = 'lacar'

// Id determinístico por contenido del pago → id estable de referencia.
function hashId(parts: (string | number)[]): string {
  const s = parts.join('|')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// POST { payments: [{ nombre, monto, fecha, cuit, email, orden, referencia, fila }] }
// Empuja cada pago a la cola de no-emparejados (mismo patrón que el webhook de Fiwind),
// para que el auto-match los empareje con órdenes por nombre + monto + fecha.
export async function POST(req: NextRequest) {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const body = await req.json().catch(() => null)
    const items = body?.payments
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'payments requerido' }, { status: 400 })
    }

    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 })
    }
    try {
      const [hot, logs, registroLacar] = await Promise.all([loadHotState(), loadLogs(), getRegistroPaymentsBySource(LACAR_SOURCE)])
      // Firmas ya presentes (cola + registro) para omitir pagos ya cargados.
      const firmas = buildSigSet(hot.unmatchedPayments, registroLacar, LACAR_SOURCE)

      let added = 0, duplicates = 0, skipped = 0
      for (const it of items) {
        const monto = Number(it?.monto)
        const fecha = it?.fecha
        // Solo positivos: los negativos son retiros/comisiones, no pagos recibidos.
        if (!Number.isFinite(monto) || monto <= 0 || !fecha || Number.isNaN(new Date(fecha).getTime())) {
          skipped++
          continue
        }
        const nombre = (it.nombre || '').toString().trim()
        const cuit = (it.cuit || '').toString().replace(/\D/g, '')
        const referencia = (it.referencia || '').toString().trim()

        // Dedup por firma (fecha+hora, nombre, monto): si ya está cargado, omitir.
        const firma = pagoFirma(monto, fecha, nombre)
        if (firmas.has(firma)) { duplicates++; continue }
        firmas.add(firma)

        // Id estable: Trx si viene (único por transferencia), si no hash por contenido.
        const id = referencia ? 'lacar-' + referencia.replace(/\s+/g, '') : 'lacar-' + hashId([firma])

        const payment: Payment = {
          mpPaymentId: id,
          monto,
          nombrePagador: nombre,
          emailPagador: (it.email || '').toString().trim(),
          cuitPagador: cuit,
          referencia: (it.referencia || '').toString(),
          operationId: (it.orden || '').toString(),
          metodoPago: 'lacar / planilla',
          fechaPago: fecha,
          status: 'approved',
          source: 'lacar',
          rawData: { origen: 'excel', orden: it.orden ?? '', fila: it.fila ?? null, referencia: it.referencia ?? '' },
        }
        const unmatched: UnmatchedPayment = { payment, timestamp: nowART(), mpPaymentId: id }
        hot.unmatchedPayments.push(unmatched)
        added++
      }

      appendActivity(logs, 'human', 'pagos_cargados_excel', { added, duplicates, skipped, total: items.length })
      await Promise.all([saveHotState(hot), saveLogs(logs)])

      return NextResponse.json({ success: true, added, duplicates, skipped, total: items.length })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
