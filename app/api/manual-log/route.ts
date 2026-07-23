import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid, isPaymentAlreadyUsed } from '@/lib/registro'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Order } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { requireUser } from '@/lib/auth/server'
import { nowART, toUTCISO } from '@/lib/utils'

const LOCK_HOLDER = 'manual-log'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }
    // Quién registra el pago (trazabilidad): el proxy ya exige sesión; acá el email.
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    const { mpPaymentId, storeName, orderNumber, matchedOrder } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ error: 'mpPaymentId required' }, { status: 400 })

    const [hot, logs, stores] = await Promise.all([loadHotState(), loadLogs(), getStores()])

    const unmatchedIndex = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const payment = hot.unmatchedPayments[unmatchedIndex].payment

    // Validación 1: la orden ya fue registrada como pagada (con cualquier pago)
    if (matchedOrder?.orderId) {
      if (await isOrderAlreadyPaid(matchedOrder.orderId)) {
        auditMatch({ action: 'manual_log.order_already_paid_blocked', actor: 'human', component: 'api/manual-log', mpPaymentId, orderId: matchedOrder.orderId, orderNumber: matchedOrder.orderNumber || orderNumber || '', storeId: matchedOrder.storeId || '', storeName: matchedOrder.storeName || storeName || '', amount: payment.monto, result: 'skipped', message: `Orden ya registrada: ${matchedOrder.orderId}` })
        return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
      }
    }

    // Validación 2: el pago ya fue emparejado con alguna orden
    if (await isPaymentAlreadyUsed(mpPaymentId)) {
      auditMatch({ action: 'manual_log.payment_already_used_blocked', actor: 'human', component: 'api/manual-log', mpPaymentId, orderId: matchedOrder?.orderId || '', orderNumber: matchedOrder?.orderNumber || orderNumber || '', storeId: matchedOrder?.storeId || '', storeName: matchedOrder?.storeName || storeName || '', amount: payment.monto, result: 'skipped', message: `Pago ya emparejado: ${mpPaymentId}` })
      return NextResponse.json({ error: 'Este pago ya fue emparejado con otra orden' }, { status: 409 })
    }

    let markMethod: string | null = null
    let markError: string | undefined

    // Si hay una orden macheada, marcarla como pagada en la plataforma correspondiente
    if (matchedOrder) {
      const store = stores[matchedOrder.storeId]
      if (store) {
        const platform = store.platform ?? 'tiendanube'
        try {
          if (platform === 'shopify') {
            const result = await markShopifyOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId, payment.monto)
            if (result.success) markMethod = 'shopify'
            else markError = result.error
          } else {
            const result = await markTNOrderAsPaid(matchedOrder.storeId, store.accessToken, matchedOrder.orderId)
            if (result.success) {
              markMethod = result.method
              if (result.method === 'note') {
                appendActivity(logs, 'system', 'mark_api_note', {
                  message: `Pago verificado, error de API no permitió marcar automaticamente. Orden: #${matchedOrder.orderNumber}`,
                  orderId: matchedOrder.orderId, storeId: matchedOrder.storeId,
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
            message: `Error al marcar orden #${matchedOrder.orderNumber} como pagada en ${platform}`,
            orderId: matchedOrder.orderId, storeId: matchedOrder.storeId, error: markError,
          })
        }
      }
    }

    hot.unmatchedPayments.splice(unmatchedIndex, 1)

    incrementPersistedMonthStats(hot, payment.monto, 'manual_pagos', matchedOrder?.storeId)

    const order: Order | undefined = matchedOrder || undefined

    // Tienda del pago: la de la orden matcheada; si se eligió a mano en el desplegable
    // (sin una orden real), se resuelve el ID por el nombre. Sin ID el pago no cuenta en
    // la planilla de la tienda ni suma a su saldo (ver registrarIngresoOrden).
    const storeNameFinal = order?.storeName || storeName || ''
    const storeIdFinal = order?.storeId
      || (storeNameFinal ? Object.values(stores).find(s => s.storeName === storeNameFinal)?.storeId : undefined)
      || undefined

    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId: payment.mpPaymentId,
      matchedAt: nowART(),
      orderId: order?.orderId,
      storeId: storeIdFinal,
      order,
      payment,
    })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'manual_pagos',
      triggeredBy: 'human',
      payment,
      order,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderTotal: order?.total,
      orderNumber: order?.orderNumber || orderNumber || '',
      orderId: order?.orderId,
      storeId: storeIdFinal,
      storeName: storeNameFinal,
      customerName: order?.customerName,
      paymentReceivedAt: toUTCISO(payment.fechaPago),
      orderCreatedAt: order?.createdAt,
      hechoPor: auth.user.email,
    }
    await appendRegistroEntry(logEntry)

    appendActivity(logs, 'human', 'pago_registrado_manual', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order?.orderNumber || orderNumber || '',
      storeName: order?.storeName || storeName || '',
    })
    auditMatch({ action: 'manual_log.paid', actor: 'human', component: 'api/manual-log', mpPaymentId: payment.mpPaymentId, orderId: order?.orderId || '', orderNumber: order?.orderNumber || orderNumber || '', storeId: order?.storeId || '', storeName: order?.storeName || storeName || '', amount: payment.monto, result: 'success', message: `Log manual: ${payment.mpPaymentId}` })

    // El registro ya se insertó en registro_log (appendRegistroEntry).
    await saveLogs(logs)
    await saveHotState(hot)

    const recentMatch = {
      mpPaymentId: payment.mpPaymentId,
      matchedAt: logEntry.timestamp,
      orderId: order?.orderId,
      storeId: storeIdFinal,
      order,
      payment,
    }

    // Si se indicó una tienda pero no se pudo resolver su ID (nombre que no coincide
    // con ninguna conectada), avisar: el pago quedó en el registro general pero NO
    // cuenta en la planilla de esa tienda ni suma a su saldo.
    const storeWarning = storeNameFinal && !storeIdFinal
      ? `La tienda "${storeNameFinal}" no coincide con ninguna tienda conectada: el pago quedó registrado pero NO suma al saldo ni a la planilla de esa tienda.`
      : undefined

    return NextResponse.json({ success: true, markMethod, markError, storeWarning, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
