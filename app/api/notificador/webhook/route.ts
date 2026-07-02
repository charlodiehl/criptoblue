import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'notificador-webhook'

// POST { secret, evento, datos: { id_transaccion, monto, titular, cbu_cvu, fecha_operacion } }
//
// Formato propio del sistema de "Notificador" (webhook a webhook — ya no pasa
// por Telegram: la Bot API no entrega mensajes de un bot a otro bot en un
// grupo, ni con privacidad desactivada + admin + Bot-to-Bot Communication Mode
// activados solo de nuestro lado). Agrega el pago a la cola con billetera "MS".
//
// Auth: secreto compartido (NOTIFICADOR_WEBHOOK_SECRET). La ruta está exenta
// del middleware de sesión (ver proxy.ts) porque la llama un servicio externo.
export async function POST(req: NextRequest) {
  try {
    const expected = process.env.NOTIFICADOR_WEBHOOK_SECRET
    if (!expected) {
      return NextResponse.json({ error: 'NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const { secret, evento, datos } = body

    if (!secret || secret !== expected) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Solo transferencias entrantes. Cualquier otro evento (retiro, egreso,
    // etc.) se descarta — mismo criterio que el filtro de depósitos de Fiwind.
    if (evento !== 'nuevo_ingreso') {
      return NextResponse.json({ success: true, skipped: true, reason: `Evento ignorado (no es nuevo_ingreso): ${evento}` })
    }
    if (!datos || typeof datos !== 'object') {
      return NextResponse.json({ error: 'datos requerido' }, { status: 400 })
    }

    const { id_transaccion, monto, titular, cbu_cvu, fecha_operacion } = datos

    if (!id_transaccion) return NextResponse.json({ error: 'datos.id_transaccion requerido' }, { status: 400 })
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'datos.monto inválido' }, { status: 400 })
    }
    const fecha = new Date(fecha_operacion)
    if (isNaN(fecha.getTime())) {
      return NextResponse.json({ error: 'datos.fecha_operacion inválida' }, { status: 400 })
    }
    const fechaISO = fecha.toISOString()

    // id_transaccion es el identificador único que ya asigna su sistema — lo
    // usamos directo, sin necesidad de generar un hash propio.
    const paymentId = `notificador-${id_transaccion}`

    if (await isPaymentAlreadyUsed(paymentId)) {
      return NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' })
    }

    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 })
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

      const yaEnCola = hot.unmatchedPayments.some(
        u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId
      )
      if (yaEnCola) {
        return NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' })
      }

      const payment: Payment = {
        mpPaymentId: paymentId,
        monto: montoNum,
        nombrePagador: typeof titular === 'string' ? titular.trim() : '',
        emailPagador: '',
        cuitPagador: '',
        referencia: typeof cbu_cvu === 'string' ? cbu_cvu : '',
        operationId: String(id_transaccion),
        metodoPago: 'notificador / transferencia',
        fechaPago: fechaISO,
        status: 'approved',
        source: 'notificador',
        rawData: { cbuCvu: cbu_cvu ?? '', evento, idTransaccion: id_transaccion },
      }

      const unmatched: UnmatchedPayment = {
        payment,
        timestamp: nowART(),
        mpPaymentId: paymentId,
      }
      hot.unmatchedPayments.push(unmatched)

      appendActivity(logs, 'system', 'notificador_pago_recibido', {
        monto: montoNum, titular: payment.nombrePagador,
      })

      await Promise.all([saveHotState(hot), saveLogs(logs)])

      // Se devuelve lo que el sistema interpretó — les sirve para confirmar de
      // su lado que el parseo de fecha/monto/titular fue correcto.
      return NextResponse.json({
        success: true,
        mpPaymentId: paymentId,
        interpretado: { fecha: fechaISO, titular: payment.nombrePagador, monto: montoNum },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
