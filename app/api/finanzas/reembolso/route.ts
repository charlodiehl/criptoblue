import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getStores, loadLogs, saveLogs, appendError, appendActivity } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { registrarReembolso } from '@/lib/balance'
import { resumenReembolsos, crearRefund, setRefundMovement, getRefundRequestById, marcarRefundRequestProcesada } from '@/lib/reembolsos'
import { walletsDeUnidad } from '@/lib/unidad'
import { fechaEgresoSaldo } from '@/lib/utils'
import { notifyTienda } from '@/lib/push'
import { audit } from '@/lib/audit'

// POST /api/finanzas/reembolso
//   { storeId, orderNumber, monto, cotizacion, comprobantePath, wallet, requestId? }
//
// Ejecuta un reembolso: exige comprobante, valida que la orden exista y que el
// ACUMULADO reembolsado no supere el total de la orden, registra el reembolso y
// RESTA el saldo de la tienda (ars + usdt con cotización manual). Si viene de una
// solicitud de tienda (requestId), la marca procesada. Admin-only.
//
// Quién paga el reembolso lo elige el admin (no se deduce solo):
//   • wallet = una billetera  → se le resta a esa billetera y se anota ahí.
//   • wallet = 'externo'      → solo se descuenta el saldo de la tienda; ninguna
//                               billetera se toca (pago por afuera).
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
    const walletSel = String(body?.wallet || '').trim()   // billetera elegida o 'externo'
    const walletOtra = String(body?.walletOtra || '').trim()   // nombre libre si es "Otras"

    if (!storeId || !orderNumber) return NextResponse.json({ error: 'Faltan la tienda o el número de orden' }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto a reembolsar inválido' }, { status: 400 })
    if (!Number.isFinite(cotizacion) || cotizacion <= 0) return NextResponse.json({ error: 'Cotización USDT/ARS inválida' }, { status: 400 })
    if (!comprobantePath) return NextResponse.json({ error: 'El comprobante es obligatorio' }, { status: 400 })

    // Quién paga: 'externo' (ninguna billetera) o una billetera válida. Obligatorio.
    const esExterno = walletSel === 'externo'
    if (!esExterno && !walletsDeUnidad().includes(walletSel)) {
      return NextResponse.json({ error: 'Elegí quién paga el reembolso (una billetera o "Pago por afuera")' }, { status: 400 })
    }
    // "Otras" es un cajón, no una billetera: se guarda con su nombre libre
    // (`otras:<nombre>`), igual que los pagos manuales, para que en el extracto se
    // vea de qué billetera salió la plata. La agregación por billetera normaliza
    // con resolveWallet(), así que sigue restándose del saldo de "Otras".
    if (walletSel === 'Otras' && !walletOtra) {
      return NextResponse.json({ error: 'Escribí el nombre de la billetera que paga' }, { status: 400 })
    }
    const wallet: string | null = esExterno
      ? null
      : (walletSel === 'Otras' ? `otras:${walletOtra.slice(0, 40)}` : walletSel)

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

    // La billetera que paga la eligió el admin (arriba). 'externo' → wallet=null:
    // el reembolso no se le anota a ninguna billetera, solo baja el saldo de la tienda.

    // El egreso (tienda y billetera) se anota en el DÍA ANTERIOR (24 hs antes). La
    // misma fecha para el refund (created_at → billetera) y el movimiento (→ tienda),
    // así ambos quedan en el mismo día.
    const fechaEgreso = fechaEgresoSaldo()

    // 1) Registrar el reembolso (fuente de verdad del tope acumulado)
    const refund = await crearRefund({
      storeId, orderNumber: order.orderNumber, orderId: order.orderId, orderTotal: total,
      monto, usdt, cotizacion, wallet, seq, comprobantePath, requestId, createdBy: auth.user.email,
      createdAt: fechaEgreso,
    })

    // 2) Restar el saldo (best-effort — reconstruible desde la fila de refunds)
    try {
      const movementId = await registrarReembolso(storeId, monto, usdt, cotizacion, descripcion, fechaEgreso)
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

    // Avisarle a la tienda que el reembolso ya se pagó (best-effort: ya está hecho).
    try {
      const montoTxt = `$${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      await notifyTienda(storeId, 'reembolso_completado', {
        title: 'Reembolso completado',
        body: `Se reembolsó ${montoTxt} de la orden #${order.orderNumber}${seq > 1 ? ` (parcial ${seq})` : ''}.`,
        url: '/tienda',
      })
    } catch { /* best-effort */ }

    return NextResponse.json({
      success: true, seq, descripcion,
      reembolsadoTotal: reembolsado + monto,
      restante: Math.max(0, total - (reembolsado + monto)),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
