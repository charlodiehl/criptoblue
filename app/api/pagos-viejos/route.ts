import { NextResponse } from 'next/server'
import { getClient } from '@/lib/storage'
import type { Payment } from '@/lib/types'

const KEY = 'criptoblue:pagos-viejos-mp'

// GET — Pagos viejos de MercadoPago que quedaron SIN emparejar (snapshot del
// borrón). Solo lectura, archivo histórico permanente. Requiere sesión (proxy.ts).
export async function GET() {
  try {
    const supabase = getClient()
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', KEY).maybeSingle()
    if (error) throw new Error(error.message)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = ((data as any)?.value ?? {}) as { payments?: Payment[]; total?: number; generatedAt?: string }
    return NextResponse.json({
      payments: value.payments ?? [],
      total: value.total ?? (value.payments?.length ?? 0),
      generatedAt: value.generatedAt ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
