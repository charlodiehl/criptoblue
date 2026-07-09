import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getComisiones, comisionTienda, comisionBilletera, setComision } from '@/lib/comisiones'
import { getStores } from '@/lib/storage'
import { WALLETS } from '@/lib/config'

// GET /api/finanzas/comisiones → { tiendas:[{storeId,storeName,pct}], billeteras:[{wallet,pct}] }
export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const [cfg, stores] = await Promise.all([getComisiones(), getStores()])
    const tiendas = Object.values(stores)
      .map(s => ({ storeId: s.storeId, storeName: s.storeName, pct: comisionTienda(cfg, s.storeId) }))
      .sort((a, b) => a.storeName.localeCompare(b.storeName))
    const billeteras = (WALLETS as readonly string[])
      .map(w => ({ wallet: w, pct: comisionBilletera(cfg, w) }))
      .sort((a, b) => a.wallet.localeCompare(b.wallet))

    return NextResponse.json({ tiendas, billeteras })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/finanzas/comisiones { tipo:'tienda'|'billetera', id, pct } → guarda el %
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || (body.tipo !== 'tienda' && body.tipo !== 'billetera') || !body.id) {
      return NextResponse.json({ error: 'tipo (tienda|billetera) e id requeridos' }, { status: 400 })
    }
    const pct = Number(body.pct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: 'Porcentaje inválido (0 a 100)' }, { status: 400 })
    }

    await setComision(body.tipo, String(body.id), pct)
    return NextResponse.json({ success: true, tipo: body.tipo, id: body.id, pct })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
