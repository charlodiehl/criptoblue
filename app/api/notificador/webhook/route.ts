import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { createHash } from 'crypto'

const LOCK_HOLDER = 'notificador-webhook'

// Fecha en formato argentino "d/m/aaaa, HH:MM:SS" o "d/m/aaaa HH:MM:SS" → ISO -03:00.
// Si no matchea ese patrón, se intenta como ISO 8601 directo (new Date()).
function parsearFecha(raw: string): string | null {
  const m = String(raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, dd, mm, yyyy, hh, min, ss] = m
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh}:${min}:${ss || '00'}-03:00`
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Monto como número directo, o string en formato argentino "$89.100,00" / "89.100,00".
function parsearMonto(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  const m = String(raw).match(/\$?\s*([\d.]+,\d{2}|\d+(?:\.\d+)?)/)
  if (!m) return null
  const s = m[1]
  // Si tiene coma, es formato argentino (punto = miles, coma = decimal)
  const num = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s)
  return Number.isFinite(num) && num > 0 ? num : null
}

// POST { secret, id?, fecha, titular, monto, cbuCvu?, tipo }
//
// Recibe transferencias directamente del sistema de "Notificador" (webhook a
// webhook, sin pasar por Telegram — la Bot API no entrega mensajes de un bot a
// otro bot en un grupo, así que el bot propio quedó descartado). Agrega el pago
// a la cola con billetera "MS".
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

    const { secret, id, fecha, titular, monto, cbuCvu, tipo } = body

    if (!secret || secret !== expected) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Solo transferencias entrantes. Cualquier otro tipo (retiro, extracción,
    // etc.) se descarta — mismo criterio que el filtro de depósitos de Fiwind.
    if (tipo && !/^transferencia$/i.test(String(tipo))) {
      return NextResponse.json({ success: true, skipped: true, reason: `Tipo ignorado (no es transferencia): ${tipo}` })
    }

    const fechaISO = fecha ? parsearFecha(fecha) : null
    const montoNum = parsearMonto(monto)
    if (!fechaISO) return NextResponse.json({ error: 'fecha inválida' }, { status: 400 })
    if (!montoNum) return NextResponse.json({ error: 'monto inválido' }, { status: 400 })

    // ID único de la transferencia: el que manden ellos si lo tienen (recomendado,
    // ej. ID de operación bancaria), o un hash determinístico de los datos como
    // fallback — evita duplicar el mismo pago si reintentan el request.
    const idBase = id ? String(id) : createHash('sha256').update(`${fechaISO}|${montoNum}|${cbuCvu || ''}|${titular || ''}`).digest('hex').slice(0, 16)
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
        monto: montoNum,
        nombrePagador: typeof titular === 'string' ? titular.trim() : '',
        emailPagador: '',
        cuitPagador: '',
        referencia: typeof cbuCvu === 'string' ? cbuCvu : '',
        operationId: idBase,
        metodoPago: 'notificador / transferencia',
        fechaPago: fechaISO,
        status: 'approved',
        source: 'notificador',
        rawData: { cbuCvu: cbuCvu ?? '', tipo: tipo ?? '', idOriginal: id ?? null },
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

      return NextResponse.json({ success: true, mpPaymentId: paymentId })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
