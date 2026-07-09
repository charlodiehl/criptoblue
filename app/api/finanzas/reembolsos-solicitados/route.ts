import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { listarRefundRequests } from '@/lib/reembolsos'
import { getStores } from '@/lib/storage'
import type { RefundRequestEstado } from '@/lib/types'

// GET /api/finanzas/reembolsos-solicitados[?estado=pendiente|procesada|rechazada]
// Solicitudes de reembolso de las tiendas, con el nombre de la tienda resuelto.
// Admin-only. Sin ?estado → devuelve solo las pendientes (para el panel).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const estadoParam = req.nextUrl.searchParams.get('estado')
    const estado: RefundRequestEstado = estadoParam === 'procesada' || estadoParam === 'rechazada' ? estadoParam : 'pendiente'

    const [solicitudes, stores] = await Promise.all([listarRefundRequests(estado), getStores()])
    const conTienda = solicitudes.map(s => ({ ...s, storeName: stores[s.storeId]?.storeName ?? s.storeId }))

    return NextResponse.json({ solicitudes: conTienda })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
