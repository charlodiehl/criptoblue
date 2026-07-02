import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import { parsearMensajeTelegram } from '@/lib/telegram-parser'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'telegram-webhook'

// POST — recibe un Update de la Bot API de Telegram (setWebhook). El bot está
// en el mismo grupo que "Notificador" con el modo privacidad desactivado, así
// que recibe una copia de cada mensaje del grupo, incluidas sus notificaciones
// de transferencias. Las agrega a la cola con billetera "MS".
//
// Auth: header X-Telegram-Bot-Api-Secret-Token (configurado en setWebhook vía
// el parámetro secret_token). La ruta está exenta del middleware de sesión
// (ver proxy.ts) porque la llama Telegram directamente.
export async function POST(req: NextRequest) {
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!expected) {
      return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (secretHeader !== expected) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const update = await req.json().catch(() => null)
    const text: string | undefined = update?.message?.text
    const chatId = update?.message?.chat?.id
    const messageId = update?.message?.message_id

    // No es un mensaje de texto (foto, sticker, join/leave, etc.) — ignorar
    // silenciosamente. Telegram solo espera 200 OK, no reintenta.
    if (!text || chatId === undefined || messageId === undefined) {
      return NextResponse.json({ success: true, skipped: true, reason: 'sin texto' })
    }

    const datos = parsearMensajeTelegram(text)
    if (!datos) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no matchea el formato de transferencia' })
    }

    // chat_id + message_id es único por mensaje — no hay ID de transacción en el texto.
    const paymentId = `telegram-${chatId}-${messageId}`

    // Dedup 1: ¿ya se emparejó este pago en el registro? (idempotencia ante reintentos de Telegram)
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
        monto: datos.monto,
        nombrePagador: datos.titular,
        emailPagador: '',                    // Telegram no informa email
        cuitPagador: '',                     // Telegram no informa CUIT
        referencia: datos.cbuCvu,
        operationId: String(messageId),
        metodoPago: 'telegram / transferencia',
        fechaPago: datos.fechaISO,
        status: 'approved',
        source: 'telegram',
        rawData: { cbuCvu: datos.cbuCvu, tipo: datos.tipo, chatId, messageId, raw: text },
      }

      const unmatched: UnmatchedPayment = {
        payment,
        timestamp: nowART(),
        mpPaymentId: paymentId,
      }
      hot.unmatchedPayments.push(unmatched)

      appendActivity(logs, 'system', 'telegram_pago_recibido', {
        monto: datos.monto, titular: datos.titular,
      })

      await Promise.all([saveHotState(hot), saveLogs(logs)])

      return NextResponse.json({ success: true, mpPaymentId: paymentId })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
