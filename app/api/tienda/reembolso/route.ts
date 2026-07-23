import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, scopedUser, setUnidad } from '@/lib/auth/server'
import { getStores, loadLogs, saveLogs, appendActivity } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { resumenReembolsos, crearRefundRequest, listarRefundRequestsTienda } from '@/lib/reembolsos'
import { notifyAdmins } from '@/lib/push'
import { puede } from '@/lib/permisos'

// POST /api/tienda/reembolso  { orderNumber, monto, aliasCbu, titular?, storeId? }
// La tienda solicita un reembolso: valida que la orden exista y que NO esté
// totalmente reembolsada; propone un monto (el admin decide el final). Crea una
// solicitud que llega al panel de Administración general.
//
// aliasCbu es OBLIGATORIO: es la cuenta a la que hay que devolver la plata, y sin
// ese dato el admin no puede pagar. `titular` es opcional (a veces la cuenta está
// a nombre de un tercero y conviene aclararlo).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const orderNumber = String(body?.orderNumber || '').trim()
    const monto = Number(body?.monto)
    const aliasCbu = String(body?.aliasCbu || '').trim()
    const titular = String(body?.titular || '').trim()
    if (!orderNumber) return NextResponse.json({ error: 'Ingresá el número de orden' }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Ingresá el monto a reembolsar' }, { status: 400 })
    if (!aliasCbu) return NextResponse.json({ error: 'Ingresá el alias o CBU donde recibir el reembolso' }, { status: 400 })
    if (aliasCbu.length > 100) return NextResponse.json({ error: 'El alias o CBU es demasiado largo' }, { status: 400 })
    if (titular.length > 100) return NextResponse.json({ error: 'El nombre del titular es demasiado largo' }, { status: 400 })

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body?.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    // Permiso: solicitar reembolsos, con los permisos DE ESA tienda (puede ser un
    // acceso secundario). El super-admin (vista espejo) siempre puede.
    if (!puede(scopedUser(auth.user, storeId), 'solicitar_reembolsos')) {
      return NextResponse.json({ error: 'No tenés permiso para solicitar reembolsos' }, { status: 403 })
    }

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // La orden debe existir
    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, orderNumber)
    } catch (err) {
      return NextResponse.json({ error: `No se pudo consultar la tienda: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }
    if (!encontrada) return NextResponse.json({ error: `La orden #${orderNumber} no existe` }, { status: 404 })
    const order = encontrada.order
    const total = Number(order.total) || 0

    // No permitir pedir sobre una orden ya totalmente reembolsada
    const { reembolsado } = await resumenReembolsos(storeId, order.orderNumber)
    const restante = Math.max(0, total - reembolsado)
    if (restante <= 0) {
      return NextResponse.json({ error: `La orden #${order.orderNumber} ya fue reembolsada en su totalidad` }, { status: 409 })
    }
    if (monto > restante + 0.01) {
      return NextResponse.json({ error: `El monto supera lo disponible para reembolsar (${restante.toFixed(2)})` }, { status: 400 })
    }

    // Evitar solicitudes duplicadas pendientes para la misma orden
    const previas = await listarRefundRequestsTienda(storeId)
    if (previas.some(r => r.estado === 'pendiente' && String(r.orderNumber) === String(order.orderNumber))) {
      return NextResponse.json({ error: `Ya tenés una solicitud de reembolso pendiente para la orden #${order.orderNumber}` }, { status: 409 })
    }

    const solicitud = await crearRefundRequest({
      storeId, orderNumber: order.orderNumber, orderId: order.orderId, orderTotal: total,
      montoSolicitado: monto, aliasCbu, titular: titular || null, createdBy: auth.user.email,
    })

    try {
      const logs = await loadLogs()
      appendActivity(logs, 'human', 'reembolso_solicitado', {
        requestId: solicitud.id, storeName: store.storeName, orderNumber: order.orderNumber, monto, solicitadoPor: auth.user.email,
      })
      await saveLogs(logs)
    } catch { /* ignore */ }

    // Notificar a los administradores (best-effort).
    try {
      const montoTxt = monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      await notifyAdmins('reembolso_solicitado', {
        title: 'Reembolso solicitado',
        body: `${store.storeName} pidió un reembolso de ${montoTxt} ARS sobre la orden #${order.orderNumber}.`,
        url: '/finanzas',
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true, id: solicitud.id, orderNumber: order.orderNumber })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
