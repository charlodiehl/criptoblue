import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { listarSolicitudes } from '@/lib/transferencias'
import { getStores } from '@/lib/storage'
import type { TransferEstado } from '@/lib/types'

// GET /api/finanzas/solicitudes[?estado=pendiente|pagada]
// Devuelve las solicitudes con el nombre de la tienda resuelto.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const estadoParam = req.nextUrl.searchParams.get('estado')
    const estado = estadoParam === 'pendiente' || estadoParam === 'pagada' ? (estadoParam as TransferEstado) : undefined

    const [solicitudes, stores] = await Promise.all([listarSolicitudes(estado), getStores()])
    const conTienda = solicitudes.map(s => ({
      ...s,
      storeName: stores[s.storeId]?.storeName ?? s.storeId,
    }))

    return NextResponse.json({ solicitudes: conTienda })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
