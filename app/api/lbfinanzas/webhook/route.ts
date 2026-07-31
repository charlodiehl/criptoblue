import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, appendError, waitForLock, releaseLock } from '@/lib/storage'
import { isPaymentAlreadyUsed, registrarPagoSoloBilletera } from '@/lib/registro'
import type { Payment, UnmatchedPayment } from '@/lib/types'
import { nowART } from '@/lib/utils'
import { runEnUnidad, unidadDeBilletera, cutoffPagos } from '@/lib/unidad'
import { LBFINANZAS_DESDE } from '@/lib/config'

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

// `dedupeKey`: para los avisos que el script de Gmail va a repetir. Si el email no se
// puede cargar, el webhook responde con error, el script no lo etiqueta como cargado y
// lo reintenta en la corrida siguiente — cada 5 minutos, para siempre. Sin acotarlo, un
// solo email escribe ~288 errores por día y se lleva puesto el resto del log.
async function registrarErrorPago(
  message: string, context?: Record<string, unknown>,
  level: 'error' | 'warning' = 'error', dedupeKey?: string,
) {
  try {
    const logs = await loadLogs()
    appendError(logs, 'lbfinanzas', level, message, context, dedupeKey)
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

// OJO CON LOS MONTOS: el aviso dice "Recibiste 59.207,05 ARS" y aparte "Comisión
// 207,95 ARS". Ese "Recibiste" es el NETO — lo que quedó en la cuenta después de que
// LB Finanzas cobrara lo suyo (0,35%). El cliente transfirió la SUMA de los dos.
//
// El que sirve es el BRUTO: es el que tiene que coincidir con el total de la orden, y
// es el mismo que venía informando el bot de Notificador (verificado contra dos pagos
// reales: 59.207,05 + 207,95 = 59.415, y 298.949,01 + 1.050 = 299.999,01, idénticos a
// los del bot). Cargar el neto dejaba todos los pagos 0,35% cortos y sin emparejar.
export interface PagoLbf {
  origen: string          // nombre de quien envió
  cbuCvu: string
  monto: number           // BRUTO: acreditado + comisión. Es el que se carga.
  montoAcreditado: number  // "Recibiste": lo que entró neto a la cuenta
  comisionArs: number      // "Comisión". NaN = no se pudo leer → no se carga el pago
  moneda: string
  fecha: Date | null
  redDePago: string
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

  const acreditado = parsearMontoLbf(mMonto[1])
  // Se distingue "no vino el campo" de "vino en 0": un depósito sin comisión trae
  // "Comisión 0,00 ARS" y es válido. Si el campo NO está, no se puede reconstruir el
  // bruto, y cargar el neto sería un pago 0,35% corto que nunca empareja. NaN → se
  // rechaza arriba, para que quede en MS-revisar y se mire a mano.
  const textoComision = campo('Comisión')
  const comisionArs = textoComision ? parsearMontoLbf(textoComision) : NaN

  return {
    origen: campo('Origen'),
    cbuCvu: campo('CBU/CVU'),
    // Redondeo a centavos OBLIGATORIO: en punto flotante 33215.33 + 116.66 da
    // 33331.990000000005, y ese monto no coincide exacto con el total de la orden.
    monto: Math.round((acreditado + comisionArs) * 100) / 100,
    montoAcreditado: acreditado,
    comisionArs,
    moneda: mMonto[2].toUpperCase(),
    fecha: parsearFechaLbf(campo('Fecha')),
    redDePago: campo('Red de pago'),
    esEntrante: true,
  }
}

function vacio(): PagoLbf {
  return { origen: '', cbuCvu: '', monto: NaN, montoAcreditado: NaN, comisionArs: NaN, moneda: '', fecha: null, redDePago: '', esEntrante: false }
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

    // Sin la comisión no se puede reconstruir lo que transfirió el cliente. Antes de
    // rechazar por "monto inválido" se distingue este caso, que tiene otra causa y
    // otra solución (el aviso vino sin el campo, o cambió la plantilla).
    if (!Number.isFinite(datos.comisionArs)) {
      await registrarErrorPago(
        `Pago de LB Finanzas sin el campo "Comisión" — NO se cargó: sin él no se puede calcular el monto bruto (acreditado: ${datos.montoAcreditado}).`,
        { messageId, asunto, ...datos })
      return NextResponse.json({ error: 'No se pudo leer la comisión: sin ella el monto bruto no es reconstruible' }, { status: 400 })
    }

    if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
      await registrarErrorPago(`Pago de LB Finanzas con monto inválido: "${datos.monto}"`, { messageId, ...datos })
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }

    // La app lleva los saldos en pesos: un aviso en otra moneda NO se carga como si
    // fueran ARS. Se avisa en el centro de errores para resolverlo a mano.
    if (datos.moneda !== 'ARS') {
      // Un aviso por email, no uno por reintento: el script lo va a seguir mandando.
      await registrarErrorPago(
        `Llegó un pago de LB Finanzas en ${datos.moneda} (${datos.monto}) — NO se cargó: la billetera opera en ARS.`,
        { messageId, ...datos }, 'error', `moneda:${messageId}`)
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

    // Corte propio de este canal: los depósitos anteriores ya entraron por el bot de
    // Notificador (ver LBFINANZAS_DESDE). Se responde OK para que el script los marque
    // como vistos y no los reintente, pero NO se cargan: sería plata duplicada.
    if (fecha.getTime() < LBFINANZAS_DESDE.getTime()) {
      return NextResponse.json({
        success: true, skipped: true,
        reason: 'depósito anterior a la conexión del canal de email (ya cargado por Notificador)',
      })
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

      // Se carga el BRUTO (acreditado + comisión de LB): es lo que transfirió el
      // cliente y por lo tanto el que coincide con el total de la orden. Es además el
      // mismo monto que informaba el bot de Notificador, así que el saldo y la
      // comisión de billetera se calculan igual que siempre.
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

      // ── ESPEJO en la unidad MS ──────────────────────────────────────────────
      // El mismo dinero se asienta en su propio libro, en la billetera "LB CriptoBlue".
      // No es plata duplicada: cada unidad ve solo lo suyo (todo filtra por la columna
      // `unidad`), y MS necesita el registro financiero de este flujo.
      //
      // Va al registro y no a la cola porque esa billetera no empareja ordenes, y va
      // DESPUES de la copia de criptoblue y en su propio try: si el espejo falla, el
      // pago que si empareja ya quedo guardado y no se pierde.
      let espejo: boolean | null = null
      try {
        espejo = await runEnUnidad('ms', () => registrarPagoSoloBilletera({
          ...payment,
          mpPaymentId: `lbcriptoblue-${messageId}`,   // id propio: el dedupe es por unidad
          source: 'lbcriptoblue',
        }))
      } catch (err) {
        await registrarErrorPago(
          `El pago ${paymentId} entro bien a CriptoBlue pero NO se pudo asentar el espejo en la billetera LB CriptoBlue (unidad MS). Asentarlo a mano.`,
          { messageId, monto: datos.monto, titular: datos.origen, error: String(err) }, 'warning')
      }

      return NextResponse.json({
        success: true, mpPaymentId: paymentId,
        espejoMs: espejo,
        interpretado: { fecha: fecha.toISOString(), titular: datos.origen, monto: datos.monto, moneda: datos.moneda,
          acreditado: datos.montoAcreditado, comision: datos.comisionArs },
      })
    } finally {
      await releaseLock(LOCK_HOLDER)
    }
  } catch (err) {
    await registrarErrorPago(`Error inesperado procesando un pago de LB Finanzas: ${String(err)}`)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
