import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'notificador-webhook'

// Registra en el errorLog un pago que llegó autenticado pero NO se pudo cargar.
// Se muestra en el centro de errores (campana del header). Solo se llama para
// requests con el secret válido — así los escaneos anónimos a la URL pública no
// generan ruido. No bloquea la respuesta si el logging falla.
async function registrarErrorPago(message: string, context?: Record<string, unknown>) {
  try {
    const logs = await loadLogs()
    appendError(logs, 'notificador', 'error', message, context)
    await saveLogs(logs)
  } catch { /* el error ya se devuelve por HTTP; no bloquear la respuesta por el log */ }
}

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
      // Config nuestra: sin el secret, ningún pago de Notificador puede entrar.
      await registrarErrorPago('NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor — ningún pago de Notificador puede procesarse')
      return NextResponse.json({ error: 'NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      // Sin secret validado todavía → podría ser un escaneo. No se registra.
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const { secret, evento, datos } = body

    if (!secret || secret !== expected) {
      // Sin secret válido → no se registra (evita ruido de escaneos a la URL pública).
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── A partir de acá el request está autenticado: cualquier fallo es un pago
    //    real de Notificador que no se pudo cargar → se registra en el centro de errores.

    // Solo transferencias entrantes. Cualquier otro evento (retiro, egreso,
    // etc.) se descarta — mismo criterio que el filtro de depósitos de Fiwind.
    // No es un error: es un evento que a propósito no procesamos.
    if (evento !== 'nuevo_ingreso') {
      return NextResponse.json({ success: true, skipped: true, reason: `Evento ignorado (no es nuevo_ingreso): ${evento}` })
    }
    if (!datos || typeof datos !== 'object') {
      await registrarErrorPago('Pago de Notificador sin el objeto "datos"', { evento })
      return NextResponse.json({ error: 'datos requerido' }, { status: 400 })
    }

    const { id_transaccion, monto, titular, cbu_cvu, fecha_operacion } = datos

    if (!id_transaccion) {
      await registrarErrorPago('Pago de Notificador sin id_transaccion', { titular, monto, fecha_operacion })
      return NextResponse.json({ error: 'datos.id_transaccion requerido' }, { status: 400 })
    }
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      await registrarErrorPago(`Pago de Notificador con monto inválido: "${monto}"`, { id_transaccion, titular, monto })
      return NextResponse.json({ error: 'datos.monto inválido' }, { status: 400 })
    }
    const fecha = new Date(fecha_operacion)
    if (isNaN(fecha.getTime())) {
      await registrarErrorPago(`Pago de Notificador con fecha inválida: "${fecha_operacion}"`, { id_transaccion, titular, monto: montoNum })
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
      // Transitorio: Notificador puede reintentar. No se registra como error.
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
    // Fallo inesperado (Supabase caído, etc.) — se registra para no perderlo.
    await registrarErrorPago(`Error inesperado procesando un pago de Notificador: ${String(err)}`)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
