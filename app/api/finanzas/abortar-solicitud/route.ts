import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getSolicitudById, marcarRechazada } from '@/lib/transferencias'
import { getStores, loadLogs, saveLogs, appendActivity } from '@/lib/storage'
import { audit } from '@/lib/audit'

// POST /api/finanzas/abortar-solicitud  { id }
//
// El admin aborta una solicitud de transferencia pendiente (decide no pagarla).
// Queda 'rechazada' y la tienda la ve como "Rechazada" en su historial. NO toca
// saldos (la solicitud nunca se pagó). marcarRechazada es un CLAIM condicional:
// si otro admin ya la resolvió → 409.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || !Number.isFinite(Number(body.id))) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 })
    }

    const solicitud = await getSolicitudById(Number(body.id))
    if (!solicitud) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
    if (solicitud.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Esa solicitud ya fue resuelta' }, { status: 409 })
    }

    const claimed = await marcarRechazada(solicitud.id, auth.user.email)
    if (!claimed) {
      return NextResponse.json({ error: 'Esa solicitud ya fue resuelta por otra persona' }, { status: 409 })
    }

    const stores = await getStores()
    const storeName = stores[solicitud.storeId]?.storeName ?? solicitud.storeId

    try {
      const logs = await loadLogs()
      appendActivity(logs, 'human', 'solicitud_abortada', {
        transferId: solicitud.id, storeName, tipo: solicitud.tipo, abortadaPor: auth.user.email,
      })
      await saveLogs(logs)
    } catch { /* no bloquear por el log de actividad */ }

    audit({
      category: 'user_action', action: 'finanzas.solicitud_abortada', result: 'success', actor: 'human',
      component: 'api/finanzas/abortar-solicitud', storeId: solicitud.storeId, storeName,
      message: `Solicitud #${solicitud.id} (${solicitud.tipo}) abortada por ${auth.user.email}`,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
