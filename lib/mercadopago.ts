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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizePayment(raw: any): Payment | null {
  const OWNER_EMAIL = 'compubairestore@gmail.com'
  const OWNER_CUIT = '20190997252'

  const firstName = raw.payer?.first_name || ''
  const lastName = raw.payer?.last_name || ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    || (raw.point_of_interaction?.transaction_data?.bank_info?.payer?.long_name || '').trim()

  const collectorEmail = raw.collector?.email || ''
  const payerEmail = raw.payer?.email || ''
  const payerCuit = raw.payer?.identification?.number || ''
  // Si el pagador es el dueño de la cuenta, limpiar esos campos para no mostrar datos propios
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

async function fetchPaymentsByRange(sinceDate: Date, rangeField: 'date_approved' | 'date_created'): Promise<Payment[]> {
  const payments: Payment[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const endDate = new Date()
    const url = new URL(`${CONFIG.mercadopago.apiBase}/v1/payments/search`)
    url.searchParams.set('sort', rangeField)
    url.searchParams.set('criteria', 'desc')
    url.searchParams.set('range', rangeField)
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

export async function fetchAllPaymentsSince(sinceDate: Date): Promise<Payment[]> {
  // Buscar por date_approved (pagos normales) y por date_created (transferencias CVU
  // que pueden tener date_approved: null aunque estén aprobadas). Deduplicar por ID.
  const [byApproved, byCreated] = await Promise.all([
    fetchPaymentsByRange(sinceDate, 'date_approved'),
    fetchPaymentsByRange(sinceDate, 'date_created'),
  ])

  const seen = new Set<string>()
  const merged: Payment[] = []
  for (const p of [...byApproved, ...byCreated]) {
    if (!seen.has(p.mpPaymentId)) {
      seen.add(p.mpPaymentId)
      merged.push(p)
    }
  }
  return merged
}
