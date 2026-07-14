import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getRefundRequestById, marcarRefundRequestRechazada } from '@/lib/reembolsos'
import { getStores, loadLogs, saveLogs, appendActivity } from '@/lib/storage'
import { audit } from '@/lib/audit'

// POST /api/finanzas/rechazar-reembolso  { id }
//
// El admin rechaza (aborta) una solicitud de reembolso pendiente. Queda
// 'rechazada' y la tienda la ve como "Rechazada". NO ejecuta el reembolso ni
// toca saldos. CLAIM condicional: si ya fue resuelta → 409.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || !Number.isFinite(Number(body.id))) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 })
    }

    const solicitud = await getRefundRequestById(Number(body.id))
    if (!solicitud) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
    if (solicitud.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Esa solicitud ya fue resuelta' }, { status: 409 })
    }

    const claimed = await marcarRefundRequestRechazada(solicitud.id, auth.user.email)
    if (!claimed) {
      return NextResponse.json({ error: 'Esa solicitud ya fue resuelta por otra persona' }, { status: 409 })
    }

    const stores = await getStores()
    const storeName = stores[solicitud.storeId]?.storeName ?? solicitud.storeId

    try {
      const logs = await loadLogs()
      appendActivity(logs, 'human', 'reembolso_rechazado', {
        requestId: solicitud.id, storeName, orderNumber: solicitud.orderNumber, rechazadoPor: auth.user.email,
      })
      await saveLogs(logs)
    } catch { /* no bloquear por el log de actividad */ }

    audit({
      category: 'user_action', action: 'finanzas.reembolso_rechazado', result: 'success', actor: 'human',
      component: 'api/finanzas/rechazar-reembolso', storeId: solicitud.storeId, storeName,
      message: `Solicitud de reembolso #${solicitud.id} (orden ${solicitud.orderNumber}) rechazada por ${auth.user.email}`,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
