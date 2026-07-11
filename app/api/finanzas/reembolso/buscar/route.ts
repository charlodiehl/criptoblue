import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { resumenReembolsos } from '@/lib/reembolsos'
import { getWalletSourceByOrder } from '@/lib/registro'
import { resolveWallet } from '@/lib/billeteras'

// POST /api/finanzas/reembolso/buscar  { storeId, orderNumber }
// Valida que la orden EXISTA en la tienda (búsqueda directa, sin límite de
// antigüedad) y devuelve su total + lo ya reembolsado (para el tope acumulado y
// la advertencia de re-reembolso). Admin-only.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const storeId = String(body?.storeId || '').trim()
    const orderNumber = String(body?.orderNumber || '').trim()
    if (!storeId || !orderNumber) {
      return NextResponse.json({ error: 'Elegí la tienda e ingresá el número de orden' }, { status: 400 })
    }

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, orderNumber)
    } catch (err) {
      return NextResponse.json({ error: `No se pudo consultar la tienda: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }
    if (!encontrada) {
      return NextResponse.json({ error: `La orden #${orderNumber} no existe en ${store.storeName}` }, { status: 404 })
    }
    const order = encontrada.order

    const { reembolsado, count, refunds } = await resumenReembolsos(storeId, order.orderNumber)
    const restante = Math.max(0, (order.total ?? 0) - reembolsado)

    // Billetera de la que vino el pago (informativo: ayuda a elegir quién paga el
    // reembolso). Sale del source del pago emparejado; las tiendas ya no tienen
    // billetera asignada, así que no hay fallback.
    let wallet: string | null = null
    try {
      wallet = resolveWallet(await getWalletSourceByOrder(storeId, order.orderNumber))
    } catch {
      wallet = null
    }

    return NextResponse.json({
      order: {
        orderNumber: order.orderNumber,
        orderId: order.orderId,
        total: order.total,
        customerName: order.customerName,
        createdAt: order.createdAt,
        wallet,
      },
      reembolsos: {
        reembolsado,
        restante,
        count,
        historial: refunds.map(r => ({ seq: r.seq, monto: r.monto, fecha: r.createdAt })),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
