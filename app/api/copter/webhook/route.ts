import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, waitForLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { runEnUnidad, unidadDeBilletera } from '@/lib/unidad'

const LOCK_HOLDER = 'copter-webhook'
const BILLETERA = 'Copter MS'

// ─────────────────────────────────────────────────────────────────────────────
// Pagos de ExchangeCopter que entran por EMAIL. Un Google Apps Script en la casilla
// blue.finanzas.adm@gmail.com (donde llegan reenviados) lee cada mail de transferencia
// recibida y hace POST acá con { asunto, cuerpo, fechaISO, messageId }. El parseo del
// pagador y el monto se hace server-side (así se ajusta sin tocar el script). El pago
// entra a la cola con billetera "Copter MS" y la FECHA DEL EMAIL. La ruta es pública
// (proxy.ts) porque la llama un servicio externo; se valida por secret propio.
// ─────────────────────────────────────────────────────────────────────────────

async function registrarErrorPago(message: string, context?: Record<string, unknown>, level: 'error' | 'warning' = 'error') {
  try {
    const logs = await loadLogs()
    appendError(logs, 'copter', level, message, context)
    await saveLogs(logs)
  } catch { /* el error ya se devuelve por HTTP */ }
}

// Monto en formato AR ("40.509,00" / "$40.509") → número. Quita todo menos dígitos y la
// coma decimal; los puntos son separadores de miles.
function parseMontoAR(s: string): number {
  const clean = String(s).replace(/[^\d,]/g, '')
  if (!clean) return NaN
  const [ent, dec] = clean.split(',')
  return Number(`${ent || '0'}${dec !== undefined ? '.' + dec.slice(0, 2) : ''}`)
}

// Del cuerpo del mail: "Recibiste una transferencia de GANGI JULIO CESAR por $40.509,00."
// → { titular, monto }. Tolerante a los saltos de línea del reenvío (se normaliza el espacio).
function parsearCuerpo(cuerpo: string, asunto: string): { titular: string; monto: number } | null {
  const texto = String(cuerpo || '').replace(/\s+/g, ' ')
  const m = texto.match(/transferencia de\s+(.+?)\s+por\s+\$?\s*([\d.,]+)/i)
  if (m) return { titular: m[1].trim(), monto: parseMontoAR(m[2]) }
  // Fallback: el monto también está en el asunto ("Recibiste una Transferencia de $40.509,00").
  const mm = String(asunto || '').match(/\$?\s*([\d.,]+)/)
  if (mm) return { titular: '', monto: parseMontoAR(mm[1]) }
  return null
}

// El webhook llega SIN sesión, así que la unidad de negocio no sale del usuario:
// sale de a qué unidad pertenece la billetera. El día que "Copter MS" se mueva de
// unidad, sus pagos la siguen solos — no hay que tocar nada acá.
export async function POST(req: NextRequest) {
  const unidad = unidadDeBilletera(BILLETERA)
  if (!unidad) {
    console.error(`[copter] la billetera "${BILLETERA}" no pertenece a ninguna unidad de negocio`)
    return NextResponse.json({ error: `La billetera "${BILLETERA}" no está asignada a ninguna unidad de negocio` }, { status: 500 })
  }
  return runEnUnidad(unidad, () => procesar(req))
}

async function procesar(req: NextRequest) {
  try {
    const expected = process.env.COPTER_WEBHOOK_SECRET
    if (!expected) {
      await registrarErrorPago('COPTER_WEBHOOK_SECRET no configurado en el servidor — ningún pago de Copter puede procesarse')
      return NextResponse.json({ error: 'COPTER_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    // Secret por header (Bearer o X-Webhook-Secret) o en el body.
    const auth = req.headers.get('authorization')
    const secret = auth
      ? (auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? auth).trim()
      : (req.headers.get('x-webhook-secret')?.trim() || (typeof body.secret === 'string' ? body.secret.trim() : null))

    const pareceReal = typeof body.messageId === 'string' && typeof body.cuerpo === 'string'
    if (!secret || secret !== expected) {
      if (pareceReal) {
        await registrarErrorPago('Llegó un pago de Copter con SECRET inválido — NO se procesó. Revisar COPTER_WEBHOOK_SECRET.',
          { messageId: body.messageId })
      }
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // A partir de acá el request está autenticado: cualquier fallo es un pago real que se
    // registra en el centro de errores para no perderlo.
    const { asunto, cuerpo, fechaISO, messageId } = body
    if (!messageId || typeof messageId !== 'string') {
      await registrarErrorPago('Pago de Copter sin messageId', { asunto })
      return NextResponse.json({ error: 'messageId requerido' }, { status: 400 })
    }
    const fecha = new Date(fechaISO)
    if (isNaN(fecha.getTime())) {
      await registrarErrorPago(`Pago de Copter con fecha inválida: "${fechaISO}"`, { messageId, asunto })
      return NextResponse.json({ error: 'fechaISO inválida' }, { status: 400 })
    }
    const parsed = parsearCuerpo(cuerpo, asunto)
    if (!parsed || !Number.isFinite(parsed.monto) || parsed.monto <= 0) {
      await registrarErrorPago('No se pudo extraer monto/pagador del email de Copter', { messageId, asunto, cuerpo: String(cuerpo || '').slice(0, 300) })
      return NextResponse.json({ error: 'No se pudo parsear el email (monto/pagador)' }, { status: 400 })
    }

    const paymentId = `copter-${messageId}`
    if (await isPaymentAlreadyUsed(paymentId)) {
      return NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' })
    }

    const locked = await waitForLock(LOCK_HOLDER, `pago ${paymentId}`, 6000, 400)
    if (!locked) {
      await registrarErrorPago(
        `No se pudo procesar el pago de Copter ${paymentId} ($${parsed.monto} · ${parsed.titular || 'sin titular'}): el sistema quedó ocupado. Recuperarlo a mano si no reintenta.`,
        { messageId, monto: parsed.monto, titular: parsed.titular, fecha: fecha.toISOString(), paymentId })
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 })
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      if (hot.unmatchedPayments.some(u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId)) {
        return NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' })
      }

      const payment: Payment = {
        mpPaymentId: paymentId,
        monto: parsed.monto,
        nombrePagador: parsed.titular,
        emailPagador: '',
        cuitPagador: '',
        referencia: '',
        operationId: messageId,
        metodoPago: 'ExchangeCopter / transferencia',
        fechaPago: fecha.toISOString(),   // FECHA DEL EMAIL (no "ahora")
        status: 'approved',
        source: 'copter',
        rawData: { asunto: asunto ?? '', messageId },
      }
      const unmatched: UnmatchedPayment = { payment, timestamp: nowART(), mpPaymentId: paymentId }
      hot.unmatchedPayments.push(unmatched)
      appendActivity(logs, 'system', 'copter_pago_recibido', { monto: parsed.monto, titular: parsed.titular })
      await Promise.all([saveHotState(hot), saveLogs(logs)])

      return NextResponse.json({
        success: true, mpPaymentId: paymentId,
        interpretado: { fecha: fecha.toISOString(), titular: parsed.titular, monto: parsed.monto },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    await registrarErrorPago(`Error inesperado procesando un pago de Copter: ${String(err)}`)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
