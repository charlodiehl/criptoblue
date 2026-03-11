import { CONFIG } from './config'
import type { Payment, Order, MatchResult } from './types'

const SERVICE_NAMES = new Set([
  'mercadopago', 'mercado pago', 'mp', 'oca', 'rapipago', 'pagofacil', 'pago facil',
])

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 100
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 100
  return Math.round((1 - levenshtein(a, b) / maxLen) * 100)
}

function nameSimilarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0

  const tokensA = na.split(' ').filter(t => t.length >= 2)
  const tokensB = nb.split(' ').filter(t => t.length >= 2)
  if (!tokensA.length || !tokensB.length) return stringSimilarity(na, nb)

  let matched = 0
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      const exact = ta === tb
      const fuzzy = ta.length > 3 && tb.length > 3 && levenshtein(ta, tb) <= 1
      if (exact || fuzzy) {
        matched++
        break
      }
    }
  }

  const tokenRatio = matched / Math.max(tokensA.length, tokensB.length)
  const strSim = stringSimilarity(na, nb)
  return Math.round(tokenRatio * 70 + strSim * 0.3)
}

function emailSimilarity(payerEmail: string, customerEmail: string): number {
  if (!payerEmail || !customerEmail) return 0
  const pe = payerEmail.toLowerCase().trim()
  const ce = customerEmail.toLowerCase().trim()

  if (pe === ce) return 100

  const [peLocal, peDomain] = pe.split('@')
  const [ceLocal, ceDomain] = ce.split('@')
  if (!peDomain || !ceDomain) return 0

  if (peDomain === ceDomain && stringSimilarity(peLocal, ceLocal) >= 60) return 60

  return 0
}

/** Extract tokens from email local part (e.g. "juan.perez123" → ["juan","perez"]) */
function emailLocalTokens(email: string): string[] {
  if (!email) return []
  const local = email.split('@')[0] || ''
  return local
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, ' ')
    .split(' ')
    .filter(t => t.length >= 3)
}

/** Compare email username against a name (and vice-versa) */
function emailNameSimilarity(email: string, name: string): number {
  const emailTokens = emailLocalTokens(email)
  if (!emailTokens.length) return 0
  const nameNorm = normalize(name)
  const nameTokens = nameNorm.split(' ').filter(t => t.length >= 3)
  if (!nameTokens.length) return 0

  let matched = 0
  for (const et of emailTokens) {
    for (const nt of nameTokens) {
      if (et === nt || (et.length > 3 && nt.length > 3 && levenshtein(et, nt) <= 1)) {
        matched++
        break
      }
    }
  }
  if (matched === 0) return 0
  const ratio = matched / Math.max(emailTokens.length, nameTokens.length)
  return Math.round(ratio * 80)
}

function isServiceName(name: string): boolean {
  return SERVICE_NAMES.has(normalize(name))
}

function hasName(payment: Payment): boolean {
  const n = normalize(payment.nombrePagador)
  return n.length > 0 && !isServiceName(payment.nombrePagador)
}

function scoreAmount(payment: Payment, order: Order): number | 'disqualified' {
  const diff = Math.abs(payment.monto - order.total)
  if (diff > 1000) return 'disqualified'
  if (diff <= 10) return 100
  if (diff <= 100) return 98
  if (diff <= 500) return 92
  return 80
}

function scoreTiming(payment: Payment, order: Order): number | 'disqualified' {
  if (!payment.fechaPago || !order.createdAt) return 50

  const payTime = new Date(payment.fechaPago).getTime()
  const orderTime = new Date(order.createdAt).getTime()
  const diffMs = payTime - orderTime
  const diffMin = diffMs / 60000

  if (diffMin < -1) return 'disqualified'
  if (diffMin <= 10) return 100
  if (diffMin <= 30) return 90
  if (diffMin <= 360) return 80
  if (diffMin <= 1440) return 65
  if (diffMin <= 2880) return 40
  if (diffMin <= 4320) return 20
  return 0
}

function extractDni(cuit: string): string {
  const digits = cuit.replace(/\D/g, '')
  if (digits.length === 11) return digits.slice(2, 10)
  if (digits.length === 10) return digits.slice(2, 10)
  return digits
}

function scoreDni(payment: Payment, order: Order): number {
  const payerCuil = payment.cuitPagador?.replace(/\D/g, '')
  const orderDni = order.customerCuit?.replace(/\D/g, '')
  if (!payerCuil || !orderDni) return 0

  // Exact match
  if (payerCuil === orderDni) return 100

  // CUIT/CUIL (11 digits) vs DNI (8 digits): extract middle 8 digits
  if (payerCuil.length === 11) {
    if (extractDni(payerCuil) === orderDni) return 100
  }
  if (orderDni.length === 11) {
    if (extractDni(orderDni) === payerCuil) return 100
  }

  // Substring partial match: if the shorter appears anywhere in the longer
  const [shorter, longer] = payerCuil.length <= orderDni.length
    ? [payerCuil, orderDni]
    : [orderDni, payerCuil]
  if (shorter.length >= 6 && longer.includes(shorter)) return 100

  return 0
}

function scoreReference(payment: Payment, order: Order): number {
  const refs = [payment.referencia, payment.operationId].filter(Boolean).map(r => r.toLowerCase())
  const ids = [order.orderNumber, order.orderId].filter(Boolean).map(i => i.toLowerCase())

  for (const ref of refs) {
    for (const id of ids) {
      if (ref.includes(id) || id.includes(ref)) return 100
    }
  }
  return 0
}

export function scoreMatch(payment: Payment, order: Order): {
  score: number
  scores: Record<string, number>
  matchType: string
  decision: 'auto_paid' | 'needs_review' | 'no_match'
} | null {
  const amountScore = scoreAmount(payment, order)
  if (amountScore === 'disqualified') return null

  const timingScore = scoreTiming(payment, order)
  if (timingScore === 'disqualified') return null

  const nameScore = hasName(payment) ? nameSimilarity(payment.nombrePagador, order.customerName) : 0

  // Cross-match: payer email username vs order customer name, and payer name vs order email
  const emailNameScore = Math.max(
    emailNameSimilarity(payment.emailPagador, order.customerName),
    emailNameSimilarity(order.customerEmail, payment.nombrePagador)
  )

  const emailScore = Math.max(
    emailSimilarity(payment.emailPagador, order.customerEmail),
    emailNameScore
  )
  const refScore = scoreReference(payment, order)
  const dniScore = scoreDni(payment, order)

  const scores = { amount: amountScore, name: nameScore, email: emailScore, reference: refScore, timing: timingScore, dni: dniScore }

  let finalScore: number
  let matchType: string

  if (dniScore >= 100) {
    // DNI/CUIL coincide exactamente → señal más fuerte disponible
    matchType = 'dni_match'
    finalScore = amountScore * 0.40 + dniScore * 0.35 + emailScore * 0.10 + timingScore * 0.15
  } else if (emailScore >= 80) {
    matchType = 'email_match'
    finalScore = amountScore * 0.35 + emailScore * 0.30 + nameScore * 0.10 + refScore * 0.10 + timingScore * 0.15
  } else if (hasName(payment) && nameScore >= 50) {
    matchType = 'name_match'
    finalScore = amountScore * 0.35 + nameScore * 0.30 + emailScore * 0.10 + refScore * 0.10 + timingScore * 0.15
  } else if (refScore >= 80) {
    matchType = 'reference_match'
    finalScore = amountScore * 0.35 + refScore * 0.30 + emailScore * 0.10 + nameScore * 0.10 + timingScore * 0.15
  } else if (hasName(payment) && nameScore < 50) {
    matchType = 'amount_only_with_name'
    const base = 60
    const bonus = nameScore * 0.15 + emailScore * 0.10 + refScore * 0.05 + timingScore * 0.15
    finalScore = Math.min(89, base + bonus)
  } else {
    matchType = 'no_identity'
    finalScore = amountScore * 0.50 + emailScore * 0.15 + refScore * 0.15 + timingScore * 0.20
  }

  finalScore = Math.round(finalScore)

  const decision: 'auto_paid' | 'needs_review' | 'no_match' =
    finalScore >= CONFIG.matching.autoThreshold ? 'auto_paid'
    : finalScore >= CONFIG.matching.reviewThreshold ? 'needs_review'
    : 'no_match'

  return { score: finalScore, scores, matchType, decision }
}

export function isThirdPartyPaymentOk(payment: Payment, targetOrder: Order, allOrders: Order[]): boolean {
  const diff = Math.abs(payment.monto - targetOrder.total)
  if (diff > 1000) return false

  const emailScore = emailSimilarity(payment.emailPagador, targetOrder.customerEmail)
  if (emailScore === 100) return true

  if (!payment.fechaPago || !targetOrder.createdAt) return false
  const payTime = new Date(payment.fechaPago).getTime()
  const orderTime = new Date(targetOrder.createdAt).getTime()
  const diffMin = (payTime - orderTime) / 60000

  if (diffMin > 30) return false

  const now = payTime
  const competing = allOrders.filter(o => {
    if (o.orderId === targetOrder.orderId) return false
    const diff2 = Math.abs(o.total - payment.monto)
    if (diff2 > 1000) return false
    const oTime = new Date(o.createdAt).getTime()
    return Math.abs(now - oTime) <= 24 * 60 * 60 * 1000
  })

  return competing.length === 0
}

export function findBestMatch(payment: Payment, orders: Order[]): MatchResult | null {
  let bestResult: MatchResult | null = null

  for (const order of orders) {
    const result = scoreMatch(payment, order)
    if (!result) continue

    if (!bestResult || result.score > bestResult.score) {
      bestResult = { ...result, order, thirdParty: false }
    }
  }

  if (!bestResult) return null

  const nameAvail = hasName(payment)
  const nameScore = bestResult.scores.name || 0
  const emailScore = bestResult.scores.email || 0

  if (nameAvail && nameScore < 50 && emailScore < 80) {
    const thirdPartyOk = isThirdPartyPaymentOk(payment, bestResult.order, orders)
    if (thirdPartyOk) {
      bestResult.score = Math.max(bestResult.score, CONFIG.matching.autoThreshold)
      bestResult.matchType = 'third_party'
      bestResult.thirdParty = true
      bestResult.decision = 'auto_paid'
    }
  }

  if (bestResult.decision === 'no_match') return null

  return bestResult
}
