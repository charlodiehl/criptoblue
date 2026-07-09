import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getStores, loadLogs, saveLogs, appendError, appendActivity } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { registrarReembolso } from '@/lib/balance'
import { resumenReembolsos, crearRefund, setRefundMovement, getRefundRequestById, marcarRefundRequestProcesada } from '@/lib/reembolsos'
import { getWalletSourceByOrder } from '@/lib/registro'
import { resolveWallet } from '@/lib/billeteras'
import { audit } from '@/lib/audit'

// POST /api/finanzas/reembolso
//   { storeId, orderNumber, monto, cotizacion, comprobantePath, requestId? }
//
// Ejecuta un reembolso: exige comprobante, valida que la orden exista y que el
// ACUMULADO reembolsado no supere el total de la orden, registra el reembolso y
// RESTA el saldo de la tienda (ars + usdt con cotización manual). Si viene de una
// solicitud de tienda (requestId), la marca procesada. Admin-only.
const EPS = 0.01  // tolerancia de centavos para el tope

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const storeId = String(body?.storeId || '').trim()
    const orderNumber = String(body?.orderNumber || '').trim()
    const monto = Number(body?.monto)
    const cotizacion = Number(body?.cotizacion)
    const comprobantePath = typeof body?.comprobantePath === 'string' ? body.comprobantePath.trim() : ''
    const requestId = body?.requestId != null ? Number(body.requestId) : null

    if (!storeId || !orderNumber) return NextResponse.json({ error: 'Faltan la tienda o el número de orden' }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto a reembolsar inválido' }, { status: 400 })
    if (!Number.isFinite(cotizacion) || cotizacion <= 0) return NextResponse.json({ error: 'Cotización USDT/ARS inválida' }, { status: 400 })
    if (!comprobantePath) return NextResponse.json({ error: 'El comprobante es obligatorio' }, { status: 400 })

    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Re-validar contra la plataforma → total autoritativo para el tope
    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, orderNumber)
    } catch (err) {
      return NextResponse.json({ error: `No se pudo consultar la tienda: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }
    if (!encontrada) return NextResponse.json({ error: `La orden #${orderNumber} no existe en ${store.storeName}` }, { status: 404 })
    const order = encontrada.order
    const total = Number(order.total) || 0

    // Tope acumulado: reembolsado previo + este monto no puede superar el total
    const { reembolsado, count } = await resumenReembolsos(storeId, order.orderNumber)
    const restante = Math.max(0, total - reembolsado)
    if (monto > restante + EPS) {
      return NextResponse.json({
        error: `El monto supera lo reembolsable. Total de la orden: ${total.toFixed(2)}. Ya reembolsado: ${reembolsado.toFixed(2)}. Disponible: ${restante.toFixed(2)}.`,
        restante,
      }, { status: 400 })
    }

    const seq = count + 1
    const usdt = monto / cotizacion
    const descripcion = `Reembolso orden #${order.orderNumber}${seq > 1 ? ` (${seq})` : ''}`

    // Billetera de la que vino el pago (se le resta el reembolso). Fuente: el source
    // del pago emparejado con esta orden; fallback a la billetera de la tienda.
    let wallet: string | null = null
    try {
      wallet = resolveWallet(await getWalletSourceByOrder(storeId, order.orderNumber)) ?? store.walletId ?? null
    } catch {
      wallet = store.walletId ?? null
    }

    // 1) Registrar el reembolso (fuente de verdad del tope acumulado)
    const refund = await crearRefund({
      storeId, orderNumber: order.orderNumber, orderId: order.orderId, orderTotal: total,
      monto, usdt, cotizacion, wallet, seq, comprobantePath, requestId, createdBy: auth.user.email,
    })

    // 2) Restar el saldo (best-effort — reconstruible desde la fila de refunds)
    try {
      const movementId = await registrarReembolso(storeId, monto, usdt, cotizacion, descripcion)
      await setRefundMovement(refund.id, movementId)
    } catch (err) {
      const logs = await loadLogs()
      appendError(logs, 'finanzas', 'error',
        `Reembolso #${refund.id} registrado pero NO se pudo restar el saldo de ${store.storeName}. Reconstruir el movimiento desde refunds.`,
        { refundId: refund.id, storeId, orderNumber: order.orderNumber, monto, error: String(err) })
      await saveLogs(logs)
    }

    // 3) Si vino de una solicitud de tienda, marcarla procesada
    if (requestId != null && Number.isFinite(requestId)) {
      try {
        const reqRow = await getRefundRequestById(requestId)
        if (reqRow && reqRow.estado === 'pendiente') await marcarRefundRequestProcesada(requestId, auth.user.email)
      } catch { /* no bloquear por la solicitud */ }
    }

    // Actividad + auditoría (informativo)
    try {
      const logs = await loadLogs()
      appendActivity(logs, 'human', 'reembolso_ejecutado', {
        refundId: refund.id, storeName: store.storeName, orderNumber: order.orderNumber,
        monto, usdt, cotizacion, seq, reembolsadoPor: auth.user.email,
      })
      await saveLogs(logs)
    } catch { /* ignore */ }

    audit({
      category: 'user_action', action: 'finanzas.reembolso', result: 'success', actor: 'human',
      component: 'api/finanzas/reembolso', storeId, storeName: store.storeName,
      orderNumber: order.orderNumber, amount: monto,
      message: `${descripcion} · ${store.storeName} · ${monto} ARS / ${usdt.toFixed(2)} USDT por ${auth.user.email}`,
    })

    return NextResponse.json({
      success: true, seq, descripcion,
      reembolsadoTotal: reembolsado + monto,
      restante: Math.max(0, total - (reembolsado + monto)),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
