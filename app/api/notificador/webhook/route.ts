import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, waitForLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { runEnUnidad, unidadDeBilletera, cutoffPagos, unidadActiva } from '@/lib/unidad'
import { abrirAuditoria } from '@/lib/webhook-audit'

const LOCK_HOLDER = 'notificador-webhook'
const BILLETERA = 'MS'

// Registra en el errorLog un pago que llegó autenticado pero NO se pudo cargar.
// Se muestra en el centro de errores (campana del header). Solo se llama para
// requests con el secret válido — así los escaneos anónimos a la URL pública no
// generan ruido. No bloquea la respuesta si el logging falla.
async function registrarErrorPago(message: string, context?: Record<string, unknown>, level: 'error' | 'warning' = 'error') {
  try {
    const logs = await loadLogs()
    appendError(logs, 'notificador', level, message, context)
    await saveLogs(logs)
  } catch { /* el error ya se devuelve por HTTP; no bloquear la respuesta por el log */ }
}

// ¿El cuerpo PARECE un ingreso real de Notificador? Sirve para distinguir un pago
// legítimo (secret roto → habría que registrarlo) de un escaneo anónimo a la URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pareceIngresoReal(body: any): boolean {
  return !!body && body.evento === 'nuevo_ingreso'
    && !!body.datos && typeof body.datos === 'object' && !!body.datos.id_transaccion
}

// El secret puede venir por header (lo estándar para webhooks) o dentro del body.
// Notificador manda su JSON tal cual (solo evento + datos) y pone el secret en el
// header, así no tiene que mezclar la credencial con el payload. Se buscan, en orden:
//   1. Authorization: "Bearer <secret>"  (o el valor crudo si no usa el prefijo Bearer)
//   2. X-Webhook-Secret / X-Notificador-Secret
//   3. body.secret  (compatibilidad con el formato anterior)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extraerSecret(req: NextRequest, body: any): string | null {
  const auth = req.headers.get('authorization')
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i)
    return (m ? m[1] : auth).trim()
  }
  const xSecret = req.headers.get('x-webhook-secret') || req.headers.get('x-notificador-secret')
  if (xSecret) return xSecret.trim()
  if (body && typeof body.secret === 'string') return body.secret.trim()
  return null
}

// POST — body: { evento, datos: { id_transaccion, monto, titular, cbu_cvu, fecha_operacion } }
// Auth: secreto compartido (NOTIFICADOR_WEBHOOK_SECRET) por header o en el body (ver extraerSecret).
//
// Formato propio del sistema de "Notificador" (webhook a webhook — ya no pasa
// por Telegram: la Bot API no entrega mensajes de un bot a otro bot en un
// grupo, ni con privacidad desactivada + admin + Bot-to-Bot Communication Mode
// activados solo de nuestro lado). Agrega el pago a la cola con billetera "MS".
//
// La ruta está exenta del middleware de sesión (ver proxy.ts) porque la llama un
// servicio externo.
// Llega sin sesión: la unidad de negocio sale de a qué unidad pertenece la billetera
// donde entra la plata (ver lib/unidad.ts).
export async function POST(req: NextRequest) {
  const unidad = unidadDeBilletera(BILLETERA)
  if (!unidad) {
    console.error(`[notificador] la billetera "${BILLETERA}" no pertenece a ninguna unidad de negocio`)
    return NextResponse.json({ error: `La billetera "${BILLETERA}" no está asignada a ninguna unidad de negocio` }, { status: 500 })
  }
  return runEnUnidad(unidad, () => procesar(req))
}

async function procesar(req: NextRequest) {
  // El cuerpo se lee PRIMERO para poder auditar el payload crudo aunque después
  // falle el secret o el parseo: sin el payload no se puede reconstruir el pago.
  const body = await req.json().catch(() => null)
  const audit = await abrirAuditoria('notificador', req, body)
  try {
    const expected = process.env.NOTIFICADOR_WEBHOOK_SECRET
    if (!expected) {
      // Config nuestra: sin el secret, ningún pago de Notificador puede entrar.
      await registrarErrorPago('NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor — ningún pago de Notificador puede procesarse')
      return audit.cerrar('error', 'NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor',
        NextResponse.json({ error: 'NOTIFICADOR_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 }))
    }

    if (!body || typeof body !== 'object') {
      // Sin secret validado todavía → podría ser un escaneo. No se registra.
      return audit.cerrar('rechazado', 'El cuerpo no es un JSON válido',
        NextResponse.json({ error: 'JSON inválido' }, { status: 400 }))
    }

    const { evento, datos } = body
    const secret = extraerSecret(req, body)
    audit.datos({ idExterno: datos?.id_transaccion, monto: datos?.monto, titular: datos?.titular, fechaOperacion: datos?.fecha_operacion })

    if (!secret || secret !== expected) {
      // Un escaneo anónimo no trae un ingreso válido → no se registra (evita ruido).
      // Pero si el cuerpo PARECE un pago real, el secret está roto/rotado y ese pago
      // se estaría perdiendo: se registra en el centro de errores.
      if (pareceIngresoReal(body)) {
        await registrarErrorPago(
          'Llegó un ingreso de Notificador con SECRET inválido — NO se procesó. Revisar NOTIFICADOR_WEBHOOK_SECRET.',
          { id_transaccion: datos?.id_transaccion, monto: datos?.monto, titular: datos?.titular },
        )
      }
      return audit.cerrar('rechazado', 'Secret inválido o ausente',
        NextResponse.json({ error: 'No autorizado' }, { status: 401 }))
    }

    // ── A partir de acá el request está autenticado: cualquier fallo es un pago
    //    real de Notificador que no se pudo cargar → se registra en el centro de errores.

    // Solo transferencias entrantes. Cualquier otro evento (retiro, egreso, etc.) se
    // descarta a propósito. Se deja como AVISO (warning, no error) por si alguna vez
    // llega un pago con el evento mal puesto y se estaría perdiendo sin darnos cuenta.
    if (evento !== 'nuevo_ingreso') {
      await registrarErrorPago(`Webhook de Notificador con evento no procesado: "${evento}"`, { evento, datos }, 'warning')
      return audit.cerrar('ignorado', `El evento no es 'nuevo_ingreso' (llegó: "${evento}")`,
        NextResponse.json({ success: true, skipped: true, reason: `Evento ignorado (no es nuevo_ingreso): ${evento}` }))
    }
    if (!datos || typeof datos !== 'object') {
      await registrarErrorPago('Pago de Notificador sin el objeto "datos"', { evento })
      return audit.cerrar('rechazado', 'Vino sin el objeto "datos"',
        NextResponse.json({ error: 'datos requerido' }, { status: 400 }))
    }

    const { id_transaccion, monto, titular, cbu_cvu, fecha_operacion } = datos

    if (!id_transaccion) {
      await registrarErrorPago('Pago de Notificador sin id_transaccion', { titular, monto, fecha_operacion })
      return audit.cerrar('rechazado', 'Vino sin id_transaccion',
        NextResponse.json({ error: 'datos.id_transaccion requerido' }, { status: 400 }))
    }
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      await registrarErrorPago(`Pago de Notificador con monto inválido: "${monto}"`, { id_transaccion, titular, monto })
      return audit.cerrar('rechazado', `Monto inválido: "${monto}"`,
        NextResponse.json({ error: 'datos.monto inválido' }, { status: 400 }))
    }
    const fecha = new Date(fecha_operacion)
    if (isNaN(fecha.getTime())) {
      await registrarErrorPago(`Pago de Notificador con fecha inválida: "${fecha_operacion}"`, { id_transaccion, titular, monto: montoNum })
      return audit.cerrar('rechazado', `Fecha de operación inválida: "${fecha_operacion}"`,
        NextResponse.json({ error: 'datos.fecha_operacion inválida' }, { status: 400 }))
    }
    const fechaISO = fecha.toISOString()

    // Corte de la unidad: nada anterior entra. Si se reenvía un pago viejo, se
    // responde OK (para que no reintente eternamente) pero NO se carga, y queda
    // en la auditoría con el motivo.
    if (fecha.getTime() < cutoffPagos().getTime()) {
      return audit.cerrar('ignorado',
        `Anterior al corte de ${unidadActiva().nombre} (${cutoffPagos().toISOString()})`,
        NextResponse.json({ success: true, skipped: true, reason: 'anterior al corte de la unidad' }))
    }

    // id_transaccion es el identificador único que ya asigna su sistema — lo
    // usamos directo, sin necesidad de generar un hash propio.
    const paymentId = `notificador-${id_transaccion}`

    audit.datos({ paymentId })
    if (await isPaymentAlreadyUsed(paymentId)) {
      // 200 pero NO se carga. Este era uno de los dos caminos que no dejaban rastro.
      return audit.cerrar('duplicado', `El id_transaccion ${id_transaccion} ya figura emparejado en el registro`,
        NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' }))
    }

    // Se REINTENTA tomar el lock unos segundos: casi siempre se libera enseguida
    // (una orden del cron, otro webhook). Antes se descartaba el pago al primer
    // intento fallido, sin dejar rastro — así se perdió el pago 20950 el 10/07.
    // 6s deja margen bajo el timeout de la función (10s). Si tras el reintento SIGUE
    // ocupado, se registra el pago en el centro de errores con todos sus datos, para
    // poder recuperarlo y no perderlo en silencio.
    const locked = await waitForLock(LOCK_HOLDER, `pago ${paymentId}`, 6000, 400)
    if (!locked) {
      await registrarErrorPago(
        `No se pudo procesar el pago de Notificador ${paymentId} ($${montoNum} · ${titular || 'sin titular'}): el sistema quedó ocupado. Recuperarlo a mano si Notificador no reintenta.`,
        { id_transaccion, monto: montoNum, titular, cbu_cvu, fecha: fechaISO, paymentId },
      )
      return audit.cerrar('error', 'El sistema quedó ocupado (no se pudo tomar el lock en 6s)',
        NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 }))
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

      const yaEnCola = hot.unmatchedPayments.some(
        u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId
      )
      if (yaEnCola) {
        // El otro camino que respondía 200 sin dejar rastro.
        return audit.cerrar('duplicado', `El id_transaccion ${id_transaccion} ya estaba en la cola de pagos`,
          NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' }))
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
      return audit.cerrar('aceptado', 'Pago agregado a la cola', NextResponse.json({
        success: true,
        mpPaymentId: paymentId,
        interpretado: { fecha: fechaISO, titular: payment.nombrePagador, monto: montoNum },
      }))
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    // Fallo inesperado (Supabase caído, etc.) — se registra para no perderlo.
    await registrarErrorPago(`Error inesperado procesando un pago de Notificador: ${String(err)}`)
    return audit.cerrar('error', `Excepción inesperada: ${String(err)}`,
      NextResponse.json({ error: String(err) }, { status: 500 }))
  }
}
