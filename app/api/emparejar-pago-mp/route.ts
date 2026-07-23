import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid, isPaymentAlreadyUsed } from '@/lib/registro'
import { esOrdenDeTercero, esPagoDeTercero } from '@/lib/config'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Order, Payment } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { requireUser } from '@/lib/auth/server'
import { nowART, toUTCISO } from '@/lib/utils'

const LOCK_HOLDER = 'emparejar-pago-mp'

// POST { payment: Payment, order: Order }
// Empareja un pago encontrado en MercadoPago (que puede NO estar en la cola de
// no-emparejados) con una orden. Marca la orden como pagada, registra en
// registro_log y, si el pago estaba en la cola, lo remueve.
export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }

    // Quién empareja (trazabilidad): el proxy ya exige sesión; acá tomamos el email.
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    const { payment, order } = await req.json() as { payment: Payment; order: Order }
    if (!payment?.mpPaymentId) return NextResponse.json({ error: 'payment.mpPaymentId requerido' }, { status: 400 })
    if (!order?.orderId || !order?.storeId) return NextResponse.json({ error: 'order.orderId y order.storeId requeridos' }, { status: 400 })

    const mpPaymentId = payment.mpPaymentId

    // Terceros: una orden de tienda de terceros SOLO empareja con un pago de billetera de
    // terceros, y al revés. Los dos universos son exclusivos y nunca se cruzan.
    if (esOrdenDeTercero(order.storeId) !== esPagoDeTercero(payment.source)) {
      return NextResponse.json({
        error: esOrdenDeTercero(order.storeId)
          ? 'Las órdenes de terceros solo emparejan con pagos de billeteras de terceros.'
          : 'Un pago de billetera de terceros solo empareja con órdenes de tiendas de terceros.',
      }, { status: 409 })
    }

    // Validación 1: la orden ya fue registrada como pagada (con cualquier pago)
    if (await isOrderAlreadyPaid(order.orderId)) {
      auditMatch({ action: 'emparejar_pago_mp.order_already_paid_blocked', actor: 'human', component: 'api/emparejar-pago-mp', mpPaymentId, orderId: order.orderId, orderNumber: order.orderNumber || '', storeId: order.storeId, storeName: order.storeName || '', amount: payment.monto, result: 'skipped', message: `Orden ya registrada: ${order.orderId}` })
      return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
    }

    // Validación 2: el pago ya fue emparejado con alguna orden (en todo el registro)
    if (await isPaymentAlreadyUsed(mpPaymentId)) {
      auditMatch({ action: 'emparejar_pago_mp.payment_already_used_blocked', actor: 'human', component: 'api/emparejar-pago-mp', mpPaymentId, orderId: order.orderId, orderNumber: order.orderNumber || '', storeId: order.storeId, storeName: order.storeName || '', amount: payment.monto, result: 'skipped', message: `Pago ya emparejado: ${mpPaymentId}` })
      return NextResponse.json({ error: 'Este pago ya fue emparejado con otra orden' }, { status: 409 })
    }

    const [hot, logs, stores] = await Promise.all([loadHotState(), loadLogs(), getStores()])
    const store = stores[order.storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Marcar la orden como pagada en la plataforma
    const platform = store.platform ?? 'tiendanube'
    let markMethod: string | null = null
    let markError: string | undefined
    try {
      if (platform === 'shopify') {
        const result = await markShopifyOrderAsPaid(order.storeId, store.accessToken, order.orderId, payment.monto)
        if (result.success) markMethod = 'shopify'
        else markError = result.error
      } else {
        const result = await markTNOrderAsPaid(order.storeId, store.accessToken, order.orderId)
        if (result.success) {
          markMethod = result.method
          if (result.method === 'note') {
            appendActivity(logs, 'system', 'mark_api_note', {
              message: `Pago verificado, error de API no permitió marcar automaticamente. Orden: #${order.orderNumber}`,
              orderId: order.orderId, storeId: order.storeId,
            })
          }
        } else {
          markError = result.error
        }
      }
    } catch (err) {
      markError = String(err)
    }

    if (markError) {
      appendActivity(logs, 'system', 'mark_api_error', {
        message: `Error al marcar orden #${order.orderNumber} como pagada en ${platform}`,
        orderId: order.orderId, storeId: order.storeId, error: markError,
      })
      await saveLogs(logs)
      return NextResponse.json({ error: `No se pudo marcar la orden como pagada: ${markError}` }, { status: 500 })
    }

    // Si el pago estaba en la cola de no-emparejados, removerlo
    const idx = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (idx >= 0) hot.unmatchedPayments.splice(idx, 1)

    incrementPersistedMonthStats(hot, payment.monto, 'manual_pagos', order.storeId)

    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId, matchedAt: nowART(),
      orderId: order.orderId, storeId: order.storeId, order, payment,
    })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'manual_pagos',
      triggeredBy: 'human',
      payment,
      order,
      mpPaymentId,
      amount: payment.monto,
      orderTotal: order.total,
      orderNumber: order.orderNumber,
      orderId: order.orderId,
      storeId: order.storeId,
      storeName: order.storeName || store.storeName,
      customerName: order.customerName,
      paymentReceivedAt: toUTCISO(payment.fechaPago),
      orderCreatedAt: order.createdAt,
      hechoPor: auth.user.email,
    }
    await appendRegistroEntry(logEntry)

    appendActivity(logs, 'human', 'pago_emparejado_por_comprobante', {
      mpPaymentId, monto: payment.monto,
      orderNumber: order.orderNumber, storeName: order.storeName || store.storeName,
    })
    auditMatch({ action: 'emparejar_pago_mp.paid', actor: 'human', component: 'api/emparejar-pago-mp', mpPaymentId, orderId: order.orderId, orderNumber: order.orderNumber, storeId: order.storeId, storeName: order.storeName || store.storeName, amount: payment.monto, result: 'success', message: `Emparejado por comprobante: ${mpPaymentId} → #${order.orderNumber}` })

    await saveLogs(logs)
    await saveHotState(hot)

    const recentMatch = {
      mpPaymentId, matchedAt: logEntry.timestamp,
      orderId: order.orderId, storeId: order.storeId, order, payment,
    }
    return NextResponse.json({ success: true, markMethod, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
