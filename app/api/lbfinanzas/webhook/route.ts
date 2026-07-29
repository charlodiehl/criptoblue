import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, waitForLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { runEnUnidad, unidadDeBilletera, cutoffPagos } from '@/lib/unidad'

const LOCK_HOLDER = 'lbfinanzas-webhook'
const BILLETERA = 'MS'

// ─────────────────────────────────────────────────────────────────────────────
// Pagos de LB Finanzas que entran por EMAIL ("Nuevo depósito recibido"). Un Apps
// Script lee cada aviso y hace POST acá con { asunto, cuerpo, cuerpoHtml, fechaISO,
// messageId }. El parseo se hace server-side, así se corrige sin tocar Apps Script.
//
// Es la billetera "MS", la misma a la que venía cargando el bot de Notificador: el
// dinero es el mismo, cambia por dónde nos enteramos. El source es 'lbfinanzas' y no
// 'notificador' para conservar la trazabilidad del origen (igual que fiwind → MF).
//
// LB Finanzas manda DOS avisos con la misma plantilla:
//   "Nuevo depósito recibido"   → "Recibiste"  + "Origen"       → ENTRA plata  ✓
//   "Transferencia realizada"   → "Enviaste"   + "Destinatario" → SALE plata   ✗
// Cargar el segundo como ingreso inflaría el saldo e inventaría pagos para emparejar,
// así que se exige "Recibiste" y se rechaza explícitamente "Enviaste".
//
// La ruta es pública (proxy.ts) porque la llama un servicio externo; se valida por
// secret propio.
// ─────────────────────────────────────────────────────────────────────────────

async function registrarErrorPago(message: string, context?: Record<string, unknown>, level: 'error' | 'warning' = 'error') {
  try {
    const logs = await loadLogs()
    appendError(logs, 'lbfinanzas', level, message, context)
    await saveLogs(logs)
  } catch { /* el error ya se devuelve por HTTP */ }
}

// Monto con separadores ambiguos → número. El ÚLTIMO separador manda, y solo es
// decimal si tiene menos de 3 dígitos detrás. Misma regla que en Bitso: confundir
// el formato AR con el US cambiaría el monto por mil.
//   "33.215,33" → 33215.33    "475.500,00" → 475500     "1.000" → 1000
export function parsearMontoLbf(raw: string): number {
  const s = String(raw).replace(/[^\d.,]/g, '')
  if (!s) return NaN
  const iSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  let ent = s, dec = ''
  if (iSep !== -1 && s.slice(iSep + 1).replace(/\D/g, '').length < 3) {
    ent = s.slice(0, iSep)
    dec = s.slice(iSep + 1)
  }
  const n = Number(ent.replace(/\D/g, '') + (dec ? '.' + dec.replace(/\D/g, '') : ''))
  return Number.isFinite(n) ? n : NaN
}

// "29.07.26 12:15" → Date. Es hora de Argentina (UTC-3), no del servidor: se arma
// con el offset explícito. El año viene de dos dígitos.
export function parsearFechaLbf(texto: string): Date | null {
  const m = String(texto || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}(?:\d{2})?)\s+(\d{1,2}):(\d{2})/)
  if (!m) return null
  const [, dd, mm, yy, hh, mi] = m
  const anio = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
  const iso = `${anio}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:00-03:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

export interface PagoLbf {
  origen: string        // nombre de quien envió
  cbuCvu: string
  monto: number
  moneda: string
  fecha: Date | null
  redDePago: string
  comisionArs: number   // lo que cobra LB Finanzas; informativo (ver más abajo)
  esEntrante: boolean
}

// Los avisos llegan REENVIADOS a la casilla de comprobantes, así que el cuerpo no
// viene limpio: arriba trae el encabezado del reenvío ("---- Forwarded message ----"
// con su propio From/Date/Subject) y algunos clientes prefijan cada línea con ">".
// Se saca eso antes de parsear.
function limpiarReenvio(texto: string): string {
  return String(texto || '')
    .split('\n')
    .map(l => l.replace(/^[ \t]*(?:>[ \t]?)+/, ''))   // marcas de citado
    .join('\n')
}

// El aviso trae "Etiqueta  Valor". En el texto plano van en la MISMA línea ("Origen
// Maria Luisa Bellia"); en el HTML aplastado pueden quedar en dos. Se aceptan las dos.
export function parsearCuerpoLbf(cuerpo: string): PagoLbf | null {
  const texto = limpiarReenvio(cuerpo)
  if (!texto.trim()) return null

  // Dirección del movimiento. Es lo primero que se mira: un "Enviaste" NO es un pago.
  const entrante = /(^|\s)Recibiste(\s|$)/i.test(texto)
  const saliente = /(^|\s)Enviaste(\s|$)/i.test(texto)
  if (!entrante || saliente) return { ...vacio(), esEntrante: false }

  // "Recibiste\n33.215,33 ARS" — el monto va en la línea siguiente al verbo.
  const mMonto = texto.match(/Recibiste\s*\$?\s*([\d.,]+)\s*([A-Za-z]{3})/i)
  if (!mMonto) return null

  // Los campos se leen SOLO de lo que sigue a "Detalle del depósito". Es la parte
  // que importa: el encabezado de un reenvío trae su propia línea "Fecha:", y sin
  // este ancla el pago quedaría fechado cuando alguien reenvió el mail, no cuando
  // se acreditó la plata. Si no aparece el ancla, se usa el texto completo.
  const iDetalle = texto.search(/Detalle del dep[oó]sito/i)
  const detalle = iDetalle >= 0 ? texto.slice(iDetalle) : texto

  const campo = (etiqueta: string): string => {
    const re = new RegExp(`^[ \\t]*${etiqueta}[ \\t]*:?[ \\t]*(?:\\r?\\n[ \\t]*)?(.+)$`, 'im')
    return (detalle.match(re)?.[1] ?? '').trim()
  }

  return {
    origen: campo('Origen'),
    cbuCvu: campo('CBU/CVU'),
    monto: parsearMontoLbf(mMonto[1]),
    moneda: mMonto[2].toUpperCase(),
    fecha: parsearFechaLbf(campo('Fecha')),
    redDePago: campo('Red de pago'),
    comisionArs: parsearMontoLbf(campo('Comisión')) || 0,
    esEntrante: true,
  }
}

function vacio(): PagoLbf {
  return { origen: '', cbuCvu: '', monto: NaN, moneda: '', fecha: null, redDePago: '', comisionArs: 0, esEntrante: false }
}

// Llega SIN sesión: la unidad de negocio sale de a qué unidad pertenece la
// billetera donde entra la plata (ver lib/unidad.ts).
export async function POST(req: NextRequest) {
  const unidad = unidadDeBilletera(BILLETERA)
  if (!unidad) {
    console.error(`[lbfinanzas] la billetera "${BILLETERA}" no pertenece a ninguna unidad de negocio`)
    return NextResponse.json({ error: `La billetera "${BILLETERA}" no está asignada a ninguna unidad de negocio` }, { status: 500 })
  }
  return runEnUnidad(unidad, () => procesar(req))
}

async function procesar(req: NextRequest) {
  const body = await req.json().catch(() => null)
  try {
    const expected = process.env.LBFINANZAS_WEBHOOK_SECRET
    if (!expected) {
      await registrarErrorPago('LBFINANZAS_WEBHOOK_SECRET no configurado en el servidor — ningún pago de LB Finanzas puede procesarse')
      return NextResponse.json({ error: 'LBFINANZAS_WEBHOOK_SECRET no configurado en el servidor' }, { status: 500 })
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const authHeader = req.headers.get('authorization')
    const secret = authHeader
      ? (authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? authHeader).trim()
      : (req.headers.get('x-webhook-secret')?.trim() || (typeof body.secret === 'string' ? body.secret.trim() : null))

    const pareceReal = typeof body.messageId === 'string' && typeof body.cuerpo === 'string'
    if (!secret || secret !== expected) {
      if (pareceReal) {
        await registrarErrorPago('Llegó un pago de LB Finanzas con SECRET inválido — NO se procesó. Revisar LBFINANZAS_WEBHOOK_SECRET.',
          { messageId: body.messageId })
      }
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // A partir de acá el request está autenticado: cualquier fallo es un pago real
    // que se registra en el centro de errores para no perderlo.
    const { asunto, cuerpo, cuerpoHtml, messageId } = body
    if (!messageId) {
      await registrarErrorPago('Pago de LB Finanzas sin messageId', { asunto })
      return NextResponse.json({ error: 'messageId requerido' }, { status: 400 })
    }

    const plano = String(cuerpo || '')
    const alterno = String(cuerpoHtml || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|th|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
    const datos = parsearCuerpoLbf(plano) ?? parsearCuerpoLbf(alterno)

    if (!datos) {
      await registrarErrorPago('No se pudo extraer los datos del email de LB Finanzas', { messageId, asunto, cuerpo: plano.slice(0, 400) })
      return NextResponse.json({ error: 'No se pudo parsear el email' }, { status: 400 })
    }

    // Aviso de transferencia SALIENTE ("Enviaste"): se responde OK para que el script
    // lo marque como visto y no lo reintente, pero NO se carga nada.
    if (!datos.esEntrante) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no es un depósito recibido' })
    }

    if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
      await registrarErrorPago(`Pago de LB Finanzas con monto inválido: "${datos.monto}"`, { messageId, ...datos })
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }

    // La app lleva los saldos en pesos: un aviso en otra moneda NO se carga como si
    // fueran ARS. Se avisa en el centro de errores para resolverlo a mano.
    if (datos.moneda !== 'ARS') {
      await registrarErrorPago(`Llegó un pago de LB Finanzas en ${datos.moneda} (${datos.monto}) — NO se cargó: la billetera opera en ARS.`, { messageId, ...datos })
      return NextResponse.json({ error: `Moneda no soportada: ${datos.moneda}` }, { status: 400 })
    }

    // Fecha real de la acreditación; si el aviso no la trajera, la de llegada del mail.
    const fecha = datos.fecha ?? (body.fechaISO ? new Date(body.fechaISO) : null)
    if (!fecha || isNaN(fecha.getTime())) {
      await registrarErrorPago('Pago de LB Finanzas sin fecha legible', { messageId, ...datos })
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    }

    // Corte de la unidad: nada anterior entra. Se responde OK para que no reintente
    // eternamente, pero NO se carga.
    if (fecha.getTime() < cutoffPagos().getTime()) {
      return NextResponse.json({ success: true, skipped: true, reason: 'anterior al corte de la unidad' })
    }

    // El aviso NO trae identificador de operación, así que el id del pago sale del
    // email (como en Copter). Consecuencia: si el mismo aviso se reenviara desde otra
    // casilla entraría de nuevo. El script marca cada mail procesado, así que en la
    // práctica no pasa; y es preferible a derivar el id del contenido, porque dos
    // depósitos iguales en el mismo minuto se pisarían y perderíamos un pago real.
    const paymentId = `lbfinanzas-${messageId}`

    if (await isPaymentAlreadyUsed(paymentId)) {
      return NextResponse.json({ success: true, duplicate: true, reason: 'ya emparejado en el registro' })
    }

    const locked = await waitForLock(LOCK_HOLDER, `pago ${paymentId}`, 6000, 400)
    if (!locked) {
      await registrarErrorPago(
        `No se pudo procesar el pago de LB Finanzas ${paymentId} ($${datos.monto} · ${datos.origen || 'sin origen'}): el sistema quedó ocupado. Recuperarlo a mano si no reintenta.`,
        { messageId, ...datos, paymentId })
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Reintentá en unos segundos.' }, { status: 409 })
    }
    try {
      const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])
      if (hot.unmatchedPayments.some(u => (u.payment?.mpPaymentId || u.mpPaymentId) === paymentId)) {
        return NextResponse.json({ success: true, duplicate: true, reason: 'ya estaba en la cola' })
      }

      // Se carga el monto BRUTO (lo que envió el pagador): es el que tiene que
      // coincidir con el total de la orden. La comisión que cobra LB Finanzas es un
      // costo de la billetera, no algo que el cliente haya dejado de pagar; el
      // descuento de la billetera lo aplica la app con su propio % (ver comisiones).
      const payment: Payment = {
        mpPaymentId: paymentId,
        monto: datos.monto,
        nombrePagador: datos.origen,
        emailPagador: '',
        cuitPagador: '',
        referencia: datos.cbuCvu,
        operationId: '',
        metodoPago: 'LB Finanzas / transferencia',
        fechaPago: fecha.toISOString(),
        status: 'approved',
        source: 'lbfinanzas',
        rawData: { asunto: asunto ?? '', messageId, cbuCvu: datos.cbuCvu, redDePago: datos.redDePago, comisionArs: datos.comisionArs },
      }
      const unmatched: UnmatchedPayment = { payment, timestamp: nowART(), mpPaymentId: paymentId }
      hot.unmatchedPayments.push(unmatched)
      appendActivity(logs, 'system', 'lbfinanzas_pago_recibido', { monto: datos.monto, titular: datos.origen })
      await Promise.all([saveHotState(hot), saveLogs(logs)])

      return NextResponse.json({
        success: true, mpPaymentId: paymentId,
        interpretado: { fecha: fecha.toISOString(), titular: datos.origen, monto: datos.monto, moneda: datos.moneda },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    await registrarErrorPago(`Error inesperado procesando un pago de LB Finanzas: ${String(err)}`)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
