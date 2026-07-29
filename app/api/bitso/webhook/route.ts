import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, waitForLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { runEnUnidad, unidadDeBilletera, cutoffPagos, unidadActiva } from '@/lib/unidad'
import { abrirAuditoria } from '@/lib/webhook-audit'

const LOCK_HOLDER = 'bitso-webhook'
const BILLETERA = 'Bitso FluoGames'

// ─────────────────────────────────────────────────────────────────────────────
// Pagos de Bitso que entran por EMAIL ("Fondos acreditados a tu cuenta"). Un Apps
// Script lee cada aviso y hace POST acá con { asunto, cuerpo, cuerpoHtml, messageId }.
// El parseo se hace server-side, así se corrige sin volver a tocar Apps Script.
//
// Ventajas sobre Copter, que se aprovechan acá:
//   • Bitso trae un "Identificador" propio de la operación → se usa como id del
//     pago. Si el mismo email se reenvía dos veces, el pago entra UNA sola.
//   • Trae la "Fecha y hora" real de la acreditación → se usa esa, no la de
//     llegada del mail (Copter no la trae y por eso allá se usa la del email).
//
// La ruta es pública (proxy.ts) porque la llama un servicio externo; se valida
// por secret propio.
// ─────────────────────────────────────────────────────────────────────────────

async function registrarErrorPago(message: string, context?: Record<string, unknown>, level: 'error' | 'warning' = 'error') {
  try {
    const logs = await loadLogs()
    appendError(logs, 'bitso', level, message, context)
    await saveLogs(logs)
  } catch { /* el error ya se devuelve por HTTP */ }
}

const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

// Quita tildes para que "septiembre"/"setiembre" y demás matcheen igual.
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// "29 julio 2026 01:47:39 UTC" → Date. El sufijo UTC es literal en el mail de
// Bitso: se interpreta SIEMPRE como UTC, nunca como hora local del servidor.
export function parsearFechaBitso(texto: string): Date | null {
  const m = sinTildes(texto).match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  if (mes === undefined) return null
  const t = Date.UTC(Number(m[3]), mes, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))
  return Number.isFinite(t) ? new Date(t) : null
}

// Monto con separadores ambiguos → número. NO se asume formato AR ni US: el ÚLTIMO
// separador manda, y solo es decimal si tiene menos de 3 dígitos detrás.
//   "5"          → 5          "46.971,20" → 46971.2
//   "46,971.20"  → 46971.2    "1.000"     → 1000       "1,000" → 1000
// Confundir los dos formatos cambiaría el monto por mil, así que la regla se aplica
// igual a los dos y no depende de saber de qué país viene el mail.
export function parsearMontoBitso(raw: string): number {
  const s = String(raw).replace(/[^\d.,]/g, '')
  if (!s) return NaN
  const iPunto = s.lastIndexOf('.')
  const iComa = s.lastIndexOf(',')
  const iSep = Math.max(iPunto, iComa)
  let ent = s, dec = ''
  if (iSep !== -1 && s.slice(iSep + 1).replace(/\D/g, '').length < 3) {
    ent = s.slice(0, iSep)
    dec = s.slice(iSep + 1)
  }
  const n = Number(ent.replace(/\D/g, '') + (dec ? '.' + dec.replace(/\D/g, '') : ''))
  return Number.isFinite(n) ? n : NaN
}

export interface PagoBitso {
  identificador: string
  remitente: string
  monto: number
  moneda: string
  fecha: Date | null
  estado: string
  origen: string
}

// El texto plano del mail conserva la tabla como pares "Etiqueta\nValor". Se lee
// así en vez de por posición: si Bitso reordena la tabla, sigue funcionando.
export function parsearCuerpoBitso(cuerpo: string): PagoBitso | null {
  const texto = String(cuerpo || '')
  if (!texto.trim()) return null

  const campo = (etiqueta: string): string => {
    const re = new RegExp(`^[ \\t]*${etiqueta}[ \\t]*\\r?\\n+[ \\t]*(.+)$`, 'im')
    return (texto.match(re)?.[1] ?? '').trim()
  }

  // "¡Recibiste $5 ARS!" → monto + moneda.
  const mMonto = texto.match(/Recibiste\s*\$?\s*([\d.,]+)\s*([A-Za-z]{3})/i)

  // El identificador está en la tabla y TAMBIÉN en el link "Ir a Actividad".
  // Se usa el link como respaldo por si la tabla viniera cortada.
  const ident = campo('Identificador')
    || (texto.match(/history\/deposit\/([A-Za-z0-9_-]+)/)?.[1] ?? '')

  if (!ident || !mMonto) return null

  return {
    identificador: ident,
    remitente: campo('Remitente'),
    monto: parsearMontoBitso(mMonto[1]),
    moneda: mMonto[2].toUpperCase(),
    fecha: parsearFechaBitso(campo('Fecha y hora')),
    estado: campo('Estado'),
    origen: campo('Origen'),
  }
}

// Llega SIN sesión: la unidad de negocio sale de a qué unidad pertenece la
// billetera donde entra la plata (ver lib/unidad.ts).
export async function POST(req: NextRequest) {
  const unidad = unidadDeBilletera(BILLETERA)
  if (!unidad) {
    console.error(`[bitso] la billetera "${BILLETERA}" no pertenece a ninguna unidad de negocio`)
    return NextResponse.json({ error: `La billetera "${BILLETERA}" no está asignada a ninguna unidad de negocio` }, { status: 500 })
  }
  return runEnUnidad(unidad, () => procesar(req))
}

async function procesar(req: NextRequest) {
  // El cuerpo se lee PRIMERO para poder auditar el payload crudo aunque después
  // falle el secret o el parseo: sin el payload no se puede reconstruir el pago.
  const body = await req.json().catch(() => null)
  const audit = await abrirAuditoria('bitso', req, body)
  try {
    const expected = process.env.BITSO_WEBHOOK_SECRET
    if (!expected) {
      await registrarErrorPago('BITSO_WEBHOOK_SECRET no configurado en el servidor — ningún pago de Bitso puede procesarse')
      return audit.cerrar('error', 'BITSO_WEBHOOK_SECRET no configurado en el servidor',
        NextResponse.json({ error: 'BITSO_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 }))
    }

    if (!body || typeof body !== 'object') {
      return audit.cerrar('rechazado', 'El cuerpo no es un JSON válido',
        NextResponse.json({ error: 'JSON inválido' }, { status: 400 }))
    }

    // Secret por header (Bearer o X-Webhook-Secret) o en el body.
    const authHeader = req.headers.get('authorization')
    const secret = authHeader
      ? (authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? authHeader).trim()
      : (req.headers.get('x-webhook-secret')?.trim() || (typeof body.secret === 'string' ? body.secret.trim() : null))

    const pareceReal = typeof body.messageId === 'string' && typeof body.cuerpo === 'string'
    if (!secret || secret !== expected) {
      if (pareceReal) {
        await registrarErrorPago('Llegó un pago de Bitso con SECRET inválido — NO se procesó. Revisar BITSO_WEBHOOK_SECRET.',
          { messageId: body.messageId })
      }
      return audit.cerrar('rechazado', 'Secret inválido o ausente',
        NextResponse.json({ error: 'No autorizado' }, { status: 401 }))
    }

    // A partir de acá el request está autenticado: cualquier fallo es un pago real
    // que se registra en el centro de errores para no perderlo.
    const { asunto, cuerpo, cuerpoHtml, messageId } = body
    audit.datos({ idExterno: typeof messageId === 'string' ? messageId : null })

    // Se parsea el texto plano; si viniera vacío se cae al HTML aplastado a texto.
    const plano = String(cuerpo || '')
    const alterno = String(cuerpoHtml || '').replace(/<[^>]+>/g, '\n')
    const datos = parsearCuerpoBitso(plano) ?? parsearCuerpoBitso(alterno)

    if (!datos) {
      await registrarErrorPago('No se pudo extraer los datos del email de Bitso', { messageId, asunto, cuerpo: plano.slice(0, 400) })
      return audit.cerrar('rechazado', 'No se pudo extraer identificador ni monto del cuerpo del email',
        NextResponse.json({ error: 'No se pudo parsear el email' }, { status: 400 }))
    }

    audit.datos({ idExterno: datos.identificador, monto: datos.monto, titular: datos.remitente, fechaOperacion: datos.fecha?.toISOString() })

    if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
      await registrarErrorPago(`Pago de Bitso con monto inválido: "${datos.monto}"`, { messageId, ...datos })
      return audit.cerrar('rechazado', `Monto inválido: "${datos.monto}"`,
        NextResponse.json({ error: 'Monto inválido' }, { status: 400 }))
    }

    // La app lleva los saldos en pesos: un aviso en otra moneda NO se carga como si
    // fueran ARS. Se avisa en el centro de errores para resolverlo a mano.
    if (datos.moneda !== 'ARS') {
      await registrarErrorPago(`Llegó un pago de Bitso en ${datos.moneda} (${datos.monto}) — NO se cargó: la billetera opera en ARS.`, { messageId, ...datos })
      return audit.cerrar('rechazado', `Moneda no soportada: ${datos.moneda} (la billetera opera en ARS)`,
        NextResponse.json({ error: `Moneda no soportada: ${datos.moneda}` }, { status: 400 }))
    }

    // Solo acreditaciones confirmadas.
    if (datos.estado && !/completad/i.test(datos.estado)) {
      return audit.cerrar('ignorado', `El estado no es "Completado" (llegó: "${datos.estado}")`,
        NextResponse.json({ success: true, skipped: true, reason: `estado ${datos.estado}` }))
    }

    const fecha = datos.fecha
    if (!fecha) {
      await registrarErrorPago('Pago de Bitso sin fecha legible', { messageId, ...datos })
      return audit.cerrar('rechazado', 'No se pudo leer la fecha y hora del email',
        NextResponse.json({ error: 'Fecha inválida' }, { status: 400 }))
    }

    // Corte de la unidad: nada anterior entra. Se responde OK para que no reintente
    // eternamente, pero NO se carga, y queda en la auditoría con el motivo.
    if (fecha.getTime() < cutoffPagos().getTime()) {
      return audit.cerrar('ignorado',
        `Anterior al corte de ${unidadActiva().nombre} (${cutoffPagos().toISOString()})`,
        NextResponse.json({ success: true, skipped: true, reason: 'anterior al corte de la unidad' }))
    }

    // Id del pago: el identificador de Bitso, no el del email. Así un reenvío del
    // mismo aviso no puede entrar dos veces.
    const paymentId = `bitso-${datos.identificador}`
    audit.datos({ paymentId })

    if (await isPaymentAlreadyUsed(paymentId)) {
      return audit.cerrar('duplicado', `El identificador ${datos.identificador} ya figura emparejado en el registro`,
        NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' }))
    }

    const locked = await waitForLock(LOCK_HOLDER, `pago ${paymentId}`, 6000, 400)
    if (!locked) {
      await registrarErrorPago(
        `No se pudo procesar el pago de Bitso ${paymentId} ($${datos.monto} · ${datos.remitente || 'sin remitente'}): el sistema quedó ocupado. Recuperarlo a mano si no reintenta.`,
        { messageId, ...datos, paymentId })
      return audit.cerrar('error', 'El sistema quedó ocupado (no se pudo tomar el lock en 6s)',
        NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 }))
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      if (hot.unmatchedPayments.some(u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId)) {
        return audit.cerrar('duplicado', `El identificador ${datos.identificador} ya estaba en la cola de pagos`,
          NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' }))
      }

      const payment: Payment = {
        mpPaymentId: paymentId,
        monto: datos.monto,
        nombrePagador: datos.remitente,
        emailPagador: '',
        cuitPagador: '',
        referencia: datos.origen,          // CBU/CVU de origen que informa Bitso
        operationId: datos.identificador,
        metodoPago: 'Bitso / transferencia',
        fechaPago: fecha.toISOString(),    // FECHA REAL de la acreditación
        status: 'approved',
        source: 'bitso',
        rawData: { asunto: asunto ?? '', messageId, origen: datos.origen },
      }
      const unmatched: UnmatchedPayment = { payment, timestamp: nowART(), mpPaymentId: paymentId }
      hot.unmatchedPayments.push(unmatched)
      appendActivity(logs, 'system', 'bitso_pago_recibido', { monto: datos.monto, titular: datos.remitente })
      await Promise.all([saveHotState(hot), saveLogs(logs)])

      return audit.cerrar('aceptado', 'Pago agregado a la cola', NextResponse.json({
        success: true, mpPaymentId: paymentId,
        interpretado: { fecha: fecha.toISOString(), titular: datos.remitente, monto: datos.monto, moneda: datos.moneda },
      }))
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    await registrarErrorPago(`Error inesperado procesando un pago de Bitso: ${String(err)}`)
    return audit.cerrar('error', `Excepción inesperada: ${String(err)}`,
      NextResponse.json({ error: String(err) }, { status: 500 }))
  }
}
