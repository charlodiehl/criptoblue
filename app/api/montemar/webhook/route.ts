import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'montemar-webhook'

// POST { secret, idCoelsa, monto, nombre, cuit, fechaISO, cbuOrigen, cvuDestino, raw, emailId }
//
// Recibe una transferencia de Montemar pay (enviada por el Google Apps Script que
// lee el email de notificación "Transferencia Recibida") y la agrega a la cola de
// pagos sin emparejar, para que el auto-match la empareje por nombre + monto +
// fecha. Montemar además informa el CUIT del que paga → señal extra para el
// emparejamiento. Billetera "Montemar".
//
// Auth: secreto compartido (MONTEMAR_WEBHOOK_SECRET). La ruta está exenta del
// middleware de sesión (ver proxy.ts) porque la llama un servicio externo.
export async function POST(req: NextRequest) {
  try {
    const expected = process.env.MONTEMAR_WEBHOOK_SECRET
    if (!expected) {
      return NextResponse.json({ error: 'MONTEMAR_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const { secret, idCoelsa, monto, nombre, cuit, fechaISO, cbuOrigen, cvuDestino, raw } = body

    // Auth por secreto compartido
    if (!secret || secret !== expected) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Validación de datos mínimos
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'monto inválido' }, { status: 400 })
    }
    if (!fechaISO || Number.isNaN(new Date(fechaISO).getTime())) {
      return NextResponse.json({ error: 'fechaISO inválida' }, { status: 400 })
    }
    if (!idCoelsa) {
      return NextResponse.json({ error: 'idCoelsa requerido' }, { status: 400 })
    }

    // El ID Coelsa es único por transferencia → lo usamos como id del pago.
    const paymentId = `montemar-${idCoelsa}`

    // Dedup 1: ¿ya se emparejó este pago en el registro? (idempotencia ante reintentos)
    if (await isPaymentAlreadyUsed(paymentId)) {
      return NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' })
    }

    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 })
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

      // Dedup 2: ¿ya está en la cola?
      const yaEnCola = hot.unmatchedPayments.some(
        u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId
      )
      if (yaEnCola) {
        return NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' })
      }

      const payment: Payment = {
        mpPaymentId: paymentId,
        monto: montoNum,
        nombrePagador: typeof nombre === 'string' ? nombre.trim() : '',
        emailPagador: '',                                                   // Montemar no informa email
        cuitPagador: typeof cuit === 'string' ? cuit.replace(/\D/g, '') : '', // Montemar SÍ informa CUIT
        referencia: typeof cvuDestino === 'string' ? cvuDestino : '',
        operationId: String(idCoelsa),
        metodoPago: 'montemar / transferencia',
        fechaPago: fechaISO,
        status: 'approved',
        source: 'montemar',
        rawData: { cbuOrigen: cbuOrigen ?? '', cvuDestino: cvuDestino ?? '', idCoelsa, raw: raw ?? '' },
      }

      const unmatched: UnmatchedPayment = {
        payment,
        timestamp: nowART(),
        mpPaymentId: paymentId,
      }
      hot.unmatchedPayments.push(unmatched)

      appendActivity(logs, 'system', 'montemar_pago_recibido', {
        idCoelsa, monto: montoNum, nombre: payment.nombrePagador,
      })

      await Promise.all([saveHotState(hot), saveLogs(logs)])

      // Se devuelve lo interpretado — sirve para confirmar de tu lado que el
      // parseo de fecha/monto/nombre/CUIT fue correcto.
      return NextResponse.json({
        success: true,
        mpPaymentId: paymentId,
        interpretado: { fecha: fechaISO, nombre: payment.nombrePagador, monto: montoNum, cuit: payment.cuitPagador },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
