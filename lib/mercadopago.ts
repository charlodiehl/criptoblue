import { CONFIG } from './config'
import type { Payment } from './types'

async function mpFetch(path: string, params?: Record<string, string>) {
  const url = new URL(`${CONFIG.mercadopago.apiBase}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${CONFIG.mercadopago.accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MP API error ${res.status}: ${text}`)
  }
  return res.json()
}

interface SearchOptions {
  hours?: number
  limit?: number
  status?: string
}

export async function searchPayments({ hours = 48, limit = 50, status = 'approved' }: SearchOptions = {}) {
  const endDate = new Date()
  const beginDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000)
  const data = await mpFetch('/v1/payments/search', {
    sort: 'date_created',
    criteria: 'desc',
    range: 'date_created',
    begin_date: beginDate.toISOString(),
    end_date: endDate.toISOString(),
    limit: String(limit),
    status,
  })
  return data as { results: unknown[]; paging: { total: number; limit: number; offset: number } }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizePayment(raw: any): Payment | null {
  const OWNER_EMAIL = 'compubairestore@gmail.com'
  const OWNER_CUIT = '20190997252'

  const payerEmail = raw.payer?.email || ''
  const payerCuit = raw.payer?.identification?.number || ''

  // Filtrar egresos: si el dueño de la cuenta es el pagador, es un pago saliente
  if (payerEmail === OWNER_EMAIL || payerCuit === OWNER_CUIT) return null

  const firstName = raw.payer?.first_name || ''
  const lastName = raw.payer?.last_name || ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  const collectorEmail = raw.collector?.email || ''
  const emailPagador = (payerEmail && payerEmail !== collectorEmail && payerEmail !== OWNER_EMAIL) ? payerEmail : ''

  return {
    mpPaymentId: String(raw.id),
    monto: raw.transaction_amount,
    nombrePagador: fullName,
    emailPagador,
    cuitPagador: (payerCuit && payerCuit !== OWNER_CUIT) ? payerCuit : '',
    referencia: raw.external_reference || '',
    operationId: raw.order?.id ? String(raw.order.id) : '',
    metodoPago: `${raw.payment_method_id || ''} / ${raw.payment_type_id || ''}`,
    fechaPago: raw.date_approved || raw.date_created || '',
    status: raw.status || '',
    source: 'mercadopago',
    rawData: raw,
  }
}

export async function fetchAllPaymentsSince(sinceDate: Date): Promise<Payment[]> {
  const payments: Payment[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const endDate = new Date()
    const url = new URL(`${CONFIG.mercadopago.apiBase}/v1/payments/search`)
    url.searchParams.set('sort', 'date_approved')
    url.searchParams.set('criteria', 'desc')
    url.searchParams.set('range', 'date_approved')
    url.searchParams.set('begin_date', sinceDate.toISOString())
    url.searchParams.set('end_date', endDate.toISOString())
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('status', 'approved')

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${CONFIG.mercadopago.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) break

    const data = await res.json()
    const results = data.results || []

    if (results.length === 0) break

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalized = (results as any[]).map((r) => normalizePayment(r)).filter((p): p is Payment => p !== null)
    payments.push(...normalized)
    offset += results.length

    if (offset >= data.paging?.total) break

    await new Promise(r => setTimeout(r, 500))
  }

  return payments
}
