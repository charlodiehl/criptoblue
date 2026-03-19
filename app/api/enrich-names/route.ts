import { NextResponse } from 'next/server'
import { loadState, saveState } from '@/lib/storage'

async function fetchLongName(mpPaymentId: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const r = await res.json()
  const firstName = r.payer?.first_name || ''
  const lastName = r.payer?.last_name || ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  if (fullName) return fullName
  const longName = (r.point_of_interaction?.transaction_data?.bank_info?.payer?.long_name || '').trim()
  return longName || null
}

export async function POST() {
  const token = process.env.CRIPTOBLUE_MP_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 500 })

  const state = await loadState()
  const toEnrich = state.unmatchedPayments.filter(u => !u.payment.nombrePagador)
  if (toEnrich.length === 0) return NextResponse.json({ enriched: 0 })

  let enriched = 0
  for (const u of toEnrich) {
    const name = await fetchLongName(u.payment.mpPaymentId, token)
    if (name) {
      u.payment.nombrePagador = name
      enriched++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  if (enriched > 0) await saveState(state)
  return NextResponse.json({ enriched, total: toEnrich.length })
}
