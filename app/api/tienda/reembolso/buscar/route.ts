import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, setUnidad } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { resumenReembolsos } from '@/lib/reembolsos'

// POST /api/tienda/reembolso/buscar  { orderNumber, storeId? }
// La tienda verifica que la orden exista antes de solicitar el reembolso. Devuelve
// el total + lo ya reembolsado (para no pedir sobre una orden totalmente reembolsada).
// Rol tienda usa SIEMPRE su propia tienda; el admin (espejo) manda storeId.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const orderNumber = String(body?.orderNumber || '').trim()
    if (!orderNumber) return NextResponse.json({ error: 'Ingresá el número de orden' }, { status: 400 })

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, orderNumber)
    } catch (err) {
      return NextResponse.json({ error: `No se pudo consultar la tienda: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }
    if (!encontrada) return NextResponse.json({ error: `La orden #${orderNumber} no existe` }, { status: 404 })
    const order = encontrada.order

    const { reembolsado } = await resumenReembolsos(storeId, order.orderNumber)
    const restante = Math.max(0, (order.total ?? 0) - reembolsado)

    return NextResponse.json({
      order: { orderNumber: order.orderNumber, orderId: order.orderId, total: order.total, customerName: order.customerName, createdAt: order.createdAt },
      reembolsos: { reembolsado, restante },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
