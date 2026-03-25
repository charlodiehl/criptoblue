/**
 * auto-match.ts
 * Lógica de auto-emparejamiento ejecutada en el servidor (cron + endpoint).
 * Espejo de computeSignals / meetsAutoCriteria del componente ManualMatchTab.
 */

import type { Payment, Order, UnmatchedPayment } from './types'

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

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const na = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
  const nb = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
  const ta = na.split(' ').filter(t => t.length >= 2)
  const tb = nb.split(' ').filter(t => t.length >= 2)
  if (!ta.length || !tb.length) return 0
  let matched = 0
  for (const tokenA of ta) {
    for (const tokenB of tb) {
      if (tokenA === tokenB) { matched++; break }
    }
  }
  return Math.round((matched / Math.max(ta.length, tb.length)) * 100)
}

// ─── Señales ─────────────────────────────────────────────────────────────────

interface Signal {
  label: string
  match: boolean
  partial: boolean
  unavailable: boolean
  value: string
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

  return [
    {
      label: 'Monto',
      value: diff === 0 ? 'Exacto' : `Dif. ${diff}`,
      match: diff <= 10, partial: diff <= 500, unavailable: false,
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
        : ns >= 70 ? 'Coincide' : ns >= 40 ? `Similar (${ns}%)` : 'No coincide',
      match: ns >= 70,
      partial: (ns >= 40 && ns < 70) || nameViaEmail,
      unavailable: !nameViaEmail && (!payment.nombrePagador || !order.customerName),
    },
    {
      label: 'Fecha / Hora',
      value: minDiff < 0 ? 'No disponible' : minDiff < 60 ? `${minDiff} min` : `${Math.round(minDiff / 60)}h`,
      match: minDiff >= 0 && minDiff <= 15,
      partial: minDiff > 15 && minDiff <= 180,
      unavailable: minDiff < 0,
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
  if (!fecha?.match) return false

  const cuitOk   = cuit?.match === true
  const emailOk  = email?.match === true || email?.partial === true
  const nombreOk = nombre?.match === true || (nombre?.partial === true && nombre.value === 'coincide con email')
  const allUnavailable = cuit?.unavailable && nombre?.unavailable && email?.unavailable

  return cuitOk || emailOk || nombreOk || (!!allUnavailable && unica?.match === true)
}

// ─── Export principal ─────────────────────────────────────────────────────────

export interface AutoMatchCandidate {
  mpPaymentId: string
  payment: Payment
  orderId: string
  storeId: string
  order: Order
}

export function findAutoMatchCandidates(
  unmatchedPayments: UnmatchedPayment[],
  orders: Order[],
  dismissedPairs: { mpPaymentId: string; orderId: string; storeId: string }[],
  confirmedIds: Set<string>,
): AutoMatchCandidate[] {
  const dismissedSet = new Set(dismissedPairs.map(p => `${p.mpPaymentId}|${p.orderId}|${p.storeId}`))
  const candidates: AutoMatchCandidate[] = []

  for (const u of unmatchedPayments) {
    const mpId = u.payment.mpPaymentId || u.mpPaymentId || ''
    if (!mpId || confirmedIds.has(mpId)) continue

    const sameMontoCount = Math.max(0, orders.filter(o => Math.abs(o.total - u.payment.monto) <= 10).length - 1)

    let bestOrder: Order | null = null
    let bestGreenCount = -1
    let bestMontoDiff = Infinity  // desempate: menor diferencia de monto gana

    for (const order of orders) {
      if (dismissedSet.has(`${mpId}|${order.orderId}|${order.storeId}`)) continue
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

  return candidates
}
