import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { getBalance } from '@/lib/balance'

// GET /api/tienda/balance[?storeId=]  → { ars, usdt, pendientes }
// storeId: rol tienda usa el suyo (ignora el query); admin lo pasa explícito.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const balance = await getBalance(storeId)
    return NextResponse.json(balance)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
