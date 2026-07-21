/**
 * auto-match.ts
 * Lógica de auto-emparejamiento ejecutada en el servidor (cron + endpoint).
 * Espejo de computeSignals / meetsAutoCriteria del componente ManualMatchTab.
 */

import type { Payment, Order, UnmatchedPayment } from './types'
import { SAMEMONTO_WINDOW_HOURS } from './config'
import { paymentWalletId, montoCoincide, pctPorDebajo } from './utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDniDigits(s: string): string {
  const d = s.replace(/\D/g, '')
  return d.length === 11 ? d.slice(2, 10) : d
}

function cuitMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '')
  const db = b.replace(/\D/g, '')
  if (!da || !db) return false
  if (da === db) return true
  if (da.length === 11 && extractDniDigits(da) === db) return true
  if (db.length === 11 && extractDniDigits(db) === da) return true
  const [shorter, longer] = da.length <= db.length ? [da, db] : [db, da]
  return shorter.length >= 6 && longer.includes(shorter)
}

function emailLocalTokens(email: string): string[] {
  return (email.split('@')[0] || '').toLowerCase().replace(/[^a-z]/g, ' ').split(' ').filter(t => t.length >= 3)
}

function emailMatchesName(email: string, name: string): boolean {
  const et = emailLocalTokens(email)
  if (!et.length) return false
  const nt = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ' ').split(' ').filter(t => t.length >= 3)
  if (!nt.length) return false
  for (const e of et) {
    for (const n of nt) {
      if (e.includes(n)) return true
    }
  }
  const partialMatched = new Set<string>()
  const usedPrefixes = new Set<string>()
  for (const e of et) {
    for (const n of nt) {
      const prefix = n.slice(0, 3)
      if (!usedPrefixes.has(prefix) && e.includes(prefix)) {
        partialMatched.add(n)
        usedPrefixes.add(prefix)
      }
    }
  }
  return partialMatched.size >= 2
}

// Quita tildes/diacríticos para comparar "Maria" y "María" como iguales.
function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Mismo algoritmo que nameSim en ManualMatchTab.tsx — deben mantenerse sincronizados.
// Coincidencia de palabras por PREFIJO de 3 caracteres (NO substring interno): así
// "ian" ya no matchea dentro de "Eliana"/"Viviana". Usa el array más corto como denominador.
// Exportada: también la usa /api/tienda/buscar-pago (criterio verde = >= 70).
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const na = sinTildes(a.toLowerCase().trim())
  const nb = sinTildes(b.toLowerCase().trim())
  if (na === nb) return 100
  const wa = na.split(/\s+/)
  const wb = nb.split(/\s+/)
  const shorter = wa.length <= wb.length ? wa : wb
  const longer  = wa.length <= wb.length ? wb : wa
  const hits = shorter.filter(w => longer.some(l => l.slice(0, 3) === w.slice(0, 3)))
  return shorter.length ? Math.round((hits.length / shorter.length) * 100) : 0
}

// ─── Señales ─────────────────────────────────────────────────────────────────

interface Signal {
  label: string
  match: boolean
  partial: boolean
  unavailable: boolean
  value: string
  timeMinutes?: number  // solo en la señal Fecha / Hora
}

function computeSignals(payment: Payment, order: Order, sameMontoCount: number): Signal[] {
  const diff = Math.abs(payment.monto - order.total)
  const hasCuit = !!(payment.cuitPagador && order.customerCuit)
  const cuitOk = hasCuit && cuitMatch(payment.cuitPagador, order.customerCuit)
  const hasEmail = !!(payment.emailPagador && order.customerEmail)
  const emailExact = hasEmail && payment.emailPagador.toLowerCase() === order.customerEmail.toLowerCase()
  const emailCross = !emailExact && (
    (payment.emailPagador ? emailMatchesName(payment.emailPagador, order.customerName) : false) ||
    (order.customerEmail ? emailMatchesName(order.customerEmail, payment.nombrePagador) : false)
  )
  const nameViaEmail = !payment.nombrePagador && !!payment.emailPagador && !!order.customerName
    ? emailMatchesName(payment.emailPagador, order.customerName)
    : false
  const ns = nameSimilarity(payment.nombrePagador, order.customerName)
  const payTime = payment.fechaPago ? new Date(payment.fechaPago).getTime() : 0
  const ordTime = order.createdAt ? new Date(order.createdAt).getTime() : 0
  const minDiff = payTime && ordTime ? Math.round(Math.abs(payTime - ordTime) / 60000) : -1

  // Monto: la regla vive en montoCoincide (lib/utils) — incluye la excepción de las
  // tiendas con descuento que no baja el total de la orden (el pago llega por debajo).
  const montoOk = montoCoincide(payment.monto, order.total, order.storeId)
  const pctMenos = pctPorDebajo(payment.monto, order.total)

  return [
    {
      label: 'Monto',
      value: diff === 0 ? 'Exacto'
        : montoOk && diff > 10 ? `Dif. ${diff} (−${pctMenos.toFixed(1)}%)`
        : `Dif. ${diff}`,
      match: montoOk, partial: diff <= 500, unavailable: false,
    },
    {
      label: 'CUIT / CUIL / DNI',
      value: !hasCuit ? 'No disponible' : cuitOk ? 'Coincide' : 'No coincide',
      match: cuitOk, partial: false, unavailable: !hasCuit,
    },
    {
      label: 'Nombre',
      value: nameViaEmail ? 'coincide con email'
        : (!payment.nombrePagador || !order.customerName) ? 'No disponible'
        : ns === 100 ? 'Exacto' : ns >= 70 ? 'Coincide' : ns >= 40 ? `Similar (${ns}%)` : 'No coincide',
      match: ns >= 70,
      partial: (ns >= 40 && ns < 70) || nameViaEmail,
      unavailable: !nameViaEmail && (!payment.nombrePagador || !order.customerName),
    },
    {
      label: 'Fecha / Hora',
      value: minDiff < 0 ? 'No disponible' : minDiff < 60 ? `${minDiff} min` : `${Math.round(minDiff / 60)}h`,
      match: minDiff >= 0 && minDiff <= 30,
      partial: minDiff > 30 && minDiff <= 180,
      unavailable: minDiff < 0,
      timeMinutes: minDiff >= 0 ? minDiff : undefined,
    },
    {
      label: 'Email',
      value: !hasEmail ? 'No disponible' : emailExact ? 'Coincide' : emailCross ? 'Nombre en email' : 'No coincide',
      match: emailExact, partial: emailCross, unavailable: !hasEmail,
    },
    {
      label: 'Otras órdenes mismo monto',
      value: sameMontoCount === 0 ? 'Única' : `${sameMontoCount} orden${sameMontoCount !== 1 ? 'es' : ''}`,
      match: sameMontoCount === 0,
      partial: sameMontoCount >= 1 && sameMontoCount <= 2,
      unavailable: false,
    },
  ]
}

// ─── Criterios de auto-marcado ────────────────────────────────────────────────

function meetsAutoCriteria(signals: Signal[]): boolean {
  const by = Object.fromEntries(signals.map(s => [s.label, s]))
  const monto  = by['Monto']
  const cuit   = by['CUIT / CUIL / DNI']
  const nombre = by['Nombre']
  const fecha  = by['Fecha / Hora']
  const email  = by['Email']
  const unica  = by['Otras órdenes mismo monto']

  if (!monto?.match) return false

  const cuitOk      = cuit?.match === true
  const emailExact  = email?.match === true
  const emailOk     = emailExact || email?.partial === true
  const nombreOk    = nombre?.match === true
  const minDiff     = fecha?.timeMinutes ?? Infinity

  // Nombre y monto EXACTOS → auto-marca sin importar el tiempo transcurrido.
  // La regla "el pago debe ser posterior a la orden" se mantiene aparte
  // (findAutoMatchCandidates descarta órdenes creadas después del pago).
  if (monto?.value === 'Exacto' && nombre?.value === 'Exacto') return true

  // Tiempo normal (≤30 min) o extendido (≤60 min) cuando hay identificador fuerte: CUIT o email exacto
  const fechaOk = minDiff <= 30 || (minDiff <= 60 && (cuitOk || emailExact))
  if (!fechaOk) return false

  // Monto + fecha (≤30 min) + orden ÚNICA para ese monto en verde alcanzan para auto-marcar,
  // AUNQUE el nombre no coincida: suele ser un pago de terceros (la transferencia sale a nombre
  // del titular de la cuenta, no del cliente de la tienda). Reemplaza el viejo requisito de
  // "pago totalmente anónimo" (que se bloqueaba si había un nombre presente pero distinto).
  const tresVerdes = monto?.match === true && fecha?.match === true && unica?.match === true
  return cuitOk || emailOk || nombreOk || tresVerdes
}

// ─── Export principal ─────────────────────────────────────────────────────────

export interface AutoMatchCandidate {
  mpPaymentId: string
  payment: Payment
  orderId: string
  storeId: string
  order: Order
}

// Diagnóstico por pago — para auditar retroactivamente qué vio el sistema
// cuando computó sameMontoCount. Se loguea en el audit log.
export interface AutoMatchDiagnostic {
  mpPaymentId: string
  payTimeISO: string | null
  windowStartISO: string
  windowEndISO: string | null
  sameMontoCount: number
  orderIdsInWindow: string[]   // todas las órdenes con monto similar dentro de la ventana
  totalOrdersInUniverse: number  // total de órdenes consideradas (post-filtros globales)
  paymentWalletId: string | null   // billetera del pago (null = sin restricción)
  ordersInWalletUniverse: number   // cuántas órdenes quedaron tras filtrar por billetera
}

export interface AutoMatchResult {
  candidates: AutoMatchCandidate[]
  diagnostics: AutoMatchDiagnostic[]
}

export function findAutoMatchCandidates(
  unmatchedPayments: UnmatchedPayment[],
  orders: Order[],
  dismissedPairs: { mpPaymentId: string; orderId: string; storeId: string }[],
  confirmedIds: Set<string>,
  confirmedOrderIds: Set<string> = new Set(),
): AutoMatchResult {
  const dismissedSet = new Set(dismissedPairs.map(p => `${p.mpPaymentId}|${p.orderId}|${p.storeId}`))
  // Filtrar órdenes ya pagadas del universo de candidatos — no deben ser candidatas
  // ni inflar el conteo de sameMontoCount
  orders = orders.filter(o => !confirmedOrderIds.has(`${o.storeId}-${o.orderId}`))
  const candidates: AutoMatchCandidate[] = []
  const diagnostics: AutoMatchDiagnostic[] = []

  const SAMEMONTO_WINDOW_MS = SAMEMONTO_WINDOW_HOURS * 60 * 60 * 1000

  for (const u of unmatchedPayments) {
    const mpId = u.payment.mpPaymentId || u.mpPaymentId || ''
    if (!mpId || confirmedIds.has(mpId)) continue

    // Excluir órdenes dismisseadas del conteo — ya fueron descartadas
    // intencionalmente y no deben inflar la ambigüedad del match.
    // Solo contar órdenes con monto similar creadas en la ventana
    // [payTime - SAMEMONTO_WINDOW_HOURS, payTime].
    // IMPORTANTE: el cutoff debe ser relativo al momento del PAGO, no al momento
    // en que corre el auto-match. Si se usa Date.now(), órdenes que eran recientes
    // al momento del pago pueden quedar fuera de la ventana cuando el auto-match
    // corre con demora, haciendo que sameMontoCount = 0 aunque haya múltiples
    // órdenes del mismo monto — caso real: órdenes 181378 y 181379 el 12/4.
    const payTime = u.payment.fechaPago ? new Date(u.payment.fechaPago).getTime() : null
    const windowStart = (payTime ?? Date.now()) - SAMEMONTO_WINDOW_MS

    // Sin restricción por billetera: cualquier pago puede emparejar con la orden
    // de cualquier tienda. (paymentWallet se conserva solo para el diagnóstico.)
    const paymentWallet = paymentWalletId(u.payment.source)
    const ordersForWallet = orders

    const ordersInWindow = ordersForWallet.filter(o =>
      Math.abs(o.total - u.payment.monto) <= 10 &&
      !dismissedSet.has(`${mpId}|${o.orderId}|${o.storeId}`) &&
      (o.createdAt ? new Date(o.createdAt).getTime() >= windowStart : true) &&
      (payTime && o.createdAt ? new Date(o.createdAt).getTime() <= payTime : true)
    )
    const sameMontoCount = Math.max(0, ordersInWindow.length - 1)

    diagnostics.push({
      mpPaymentId: mpId,
      payTimeISO: payTime ? new Date(payTime).toISOString() : null,
      windowStartISO: new Date(windowStart).toISOString(),
      windowEndISO: payTime ? new Date(payTime).toISOString() : null,
      sameMontoCount,
      orderIdsInWindow: ordersInWindow.map(o => `${o.storeId}-${o.orderId}`),
      totalOrdersInUniverse: orders.length,
      paymentWalletId: paymentWallet,
      ordersInWalletUniverse: ordersForWallet.length,
    })

    let bestOrder: Order | null = null
    let bestGreenCount = -1
    let bestMontoDiff = Infinity  // desempate: menor diferencia de monto gana

    for (const order of ordersForWallet) {
      if (dismissedSet.has(`${mpId}|${order.orderId}|${order.storeId}`)) continue

      // Regla dura: el pago no puede ser anterior a la creación de la orden
      const ordTime = order.createdAt ? new Date(order.createdAt).getTime() : 0
      if (payTime && ordTime && payTime < ordTime) continue

      const signals = computeSignals(u.payment, order, sameMontoCount)
      if (!meetsAutoCriteria(signals)) continue
      const greenCount = signals.filter(s => s.match).length
      const montoDiff = Math.abs(u.payment.monto - order.total)
      if (greenCount > bestGreenCount || (greenCount === bestGreenCount && montoDiff < bestMontoDiff)) {
        bestGreenCount = greenCount
        bestMontoDiff = montoDiff
        bestOrder = order
      }
    }

    if (bestOrder) {
      candidates.push({ mpPaymentId: mpId, payment: u.payment, orderId: bestOrder.orderId, storeId: bestOrder.storeId, order: bestOrder })
    }
  }

  return { candidates, diagnostics }
}
