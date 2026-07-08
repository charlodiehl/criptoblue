import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getBalances } from '@/lib/balance'
import { getStores } from '@/lib/storage'

// GET /api/finanzas/balances → una tarjeta por tienda: { storeId, storeName, ars, usdt, pendientes }
// Incluye TODAS las tiendas conectadas (aunque no tengan movimientos → 0).
export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const [balances, stores] = await Promise.all([getBalances(), getStores()])
    const byStore = new Map(balances.map(b => [b.storeId, b]))

    const cards = Object.values(stores).map(s => {
      const b = byStore.get(s.storeId)
      return {
        storeId: s.storeId,
        storeName: s.storeName,
        ars: b?.ars ?? 0,
        usdt: b?.usdt ?? 0,
        pendientes: b?.pendientes ?? 0,
      }
    }).sort((a, b) => a.storeName.localeCompare(b.storeName))

    return NextResponse.json({ cards })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
