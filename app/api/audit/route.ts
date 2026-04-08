import { NextRequest, NextResponse } from 'next/server'
import { queryAudit } from '@/lib/audit'
import type { AuditCategory } from '@/lib/types'

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams
    const fromStr = params.get('from')
    if (!fromStr) return NextResponse.json({ error: 'from es requerido (YYYY-MM-DD)' }, { status: 400 })

    const from = new Date(fromStr)
    const to = params.get('to') ? new Date(params.get('to')!) : undefined
    const category = params.get('category') as AuditCategory | undefined
    const action = params.get('action') || undefined
    const mpPaymentId = params.get('mpPaymentId') || undefined
    const orderNumber = params.get('orderNumber') || undefined
    const storeId = params.get('storeId') || undefined

    const entries = await queryAudit({ from, to, category, action, mpPaymentId, orderNumber, storeId })

    return NextResponse.json({
      count: entries.length,
      entries: entries.slice(-500), // últimas 500 para no sobrecargar la respuesta
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
