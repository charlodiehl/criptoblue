import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import { parsearMensajeNotificador } from '@/lib/notificador-parser'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { createHash } from 'crypto'

const LOCK_HOLDER = 'notificador-webhook'

// POST { secret, mensaje }
//
// "mensaje" es el mismo texto que el sistema de "Notificador" ya manda a su
// grupo de Telegram, reenviado tal cual — se parsea acá (Fecha, Titular,
// Monto, CBU/CVU, Tipo). Agrega el pago a la cola con billetera "MS".
//
// Reemplaza el intento anterior de leer los mensajes desde un bot propio de
// Telegram en el mismo grupo: la Bot API no entrega mensajes de un bot a otro
// bot en un grupo, ni con privacidad desactivada + admin + Bot-to-Bot
// Communication Mode activados solo de nuestro lado.
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

    const { secret, mensaje } = body

    if (!secret || secret !== expected) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    if (typeof mensaje !== 'string' || !mensaje.trim()) {
      return NextResponse.json({ error: 'mensaje requerido (el texto completo de la notificación)' }, { status: 400 })
    }

    const datos = parsearMensajeNotificador(mensaje)
    if (!datos) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no se pudo interpretar el mensaje (falta Fecha o Monto legible)' })
    }

    // Solo transferencias entrantes. Cualquier otro tipo (retiro, extracción,
    // etc.) se descarta — mismo criterio que el filtro de depósitos de Fiwind.
    if (datos.tipo && !/^transferencia$/i.test(datos.tipo)) {
      return NextResponse.json({ success: true, skipped: true, reason: `Tipo ignorado (no es transferencia): ${datos.tipo}` })
    }

    // El texto no trae un ID de transacción propio: se genera un hash
    // determinístico de los datos como ID único, para no duplicar el mismo
    // pago si reintentan el request con el mismo mensaje.
    const idBase = createHash('sha256')
      .update(`${datos.fechaISO}|${datos.monto}|${datos.cbuCvu}|${datos.titular}`)
      .digest('hex').slice(0, 16)
    const paymentId = `notificador-${idBase}`

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
        monto: datos.monto,
        nombrePagador: datos.titular,
        emailPagador: '',
        cuitPagador: '',
        referencia: datos.cbuCvu,
        operationId: idBase,
        metodoPago: 'notificador / transferencia',
        fechaPago: datos.fechaISO,
        status: 'approved',
        source: 'notificador',
        rawData: { cbuCvu: datos.cbuCvu, tipo: datos.tipo, mensaje },
      }

      const unmatched: UnmatchedPayment = {
        payment,
        timestamp: nowART(),
        mpPaymentId: paymentId,
      }
      hot.unmatchedPayments.push(unmatched)

      appendActivity(logs, 'system', 'notificador_pago_recibido', {
        monto: datos.monto, titular: datos.titular,
      })

      await Promise.all([saveHotState(hot), saveLogs(logs)])

      // Se devuelve lo que el sistema interpretó del mensaje — les sirve para
      // confirmar de su lado que el parseo de fecha/monto/titular fue correcto.
      return NextResponse.json({
        success: true,
        mpPaymentId: paymentId,
        interpretado: { fecha: datos.fechaISO, titular: datos.titular, monto: datos.monto },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
