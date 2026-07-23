import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendError, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid, isPaymentAlreadyUsed } from '@/lib/registro'
import { markOrderAsPaid as markTNOrderAsPaid, getPendingOrders as getTNOrders } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid, getPendingOrders as getShopifyOrders } from '@/lib/shopify'
import { HARD_CUTOFF_ORDERS } from '@/lib/config'
import type { LogEntry } from '@/lib/types'
import { audit, auditMatch } from '@/lib/audit'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { nowART, toUTCISO } from '@/lib/utils'

const LOCK_HOLDER = 'manual-match'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER, undefined, 30_000)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }
    // Quién empareja (trazabilidad): el proxy ya exige sesión; acá tomamos el email.
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const { mpPaymentId, orderId, storeId, order: orderFromClient } = await req.json()
    if (!mpPaymentId || !orderId || !storeId) {
      return NextResponse.json({ error: 'mpPaymentId, orderId, storeId required' }, { status: 400 })
    }

    const [hot, logs, stores] = await Promise.all([
      loadHotState(), loadLogs(), getStores()
    ])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    const unmatchedIndex = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    // Validación 1: la orden ya fue registrada como pagada (con cualquier pago)
    if (await isOrderAlreadyPaid(orderId)) {
      audit({ category: 'match', action: 'manual_match.order_already_paid_blocked', result: 'skipped', actor: 'human', component: 'api/manual-match', message: `Orden ya registrada: ${orderId}`, mpPaymentId, orderId })
      return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
    }

    // Validación 2: el pago ya fue emparejado con alguna orden
    if (await isPaymentAlreadyUsed(mpPaymentId)) {
      audit({ category: 'match', action: 'manual_match.payment_already_used_blocked', result: 'skipped', actor: 'human', component: 'api/manual-match', message: `Pago ya emparejado: ${mpPaymentId}`, mpPaymentId, orderId })
      return NextResponse.json({ error: 'Este pago ya fue emparejado con otra orden' }, { status: 409 })
    }

    const unmatched = hot.unmatchedPayments[unmatchedIndex]
    const payment = unmatched.payment

    const platform = store.platform ?? 'tiendanube'

    let order = orderFromClient || null
    if (!order) {
      try {
        const since = new Date(Math.max(Date.now() - 48 * 3600000, HARD_CUTOFF_ORDERS.getTime()))
        const fetchOrders = platform === 'shopify' ? getShopifyOrders : getTNOrders
        const orders = await fetchOrders(storeId, store.accessToken, store.storeName, since)
        order = orders.find(o => o.orderId === orderId) || null
      } catch {
        // Si falla el fetch igual continuamos; el log quedará sin datos de orden
      }
    }

    let markSuccess: boolean
    let markError: string | undefined
    let markMethod: string | undefined

    if (platform === 'shopify') {
      const amount = order?.total ?? payment.monto
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, orderId, amount)
      markSuccess = result.success
      markError = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, orderId)
      markSuccess = result.success
      markError = result.error
      markMethod = result.method
      if (result.success && result.method === 'note') {
        console.warn('[manual-match] WARNING: TN returned 403/422 for payment_status change. Only a note was added. Order may NOT be marked paid in TiendaNube.')
        appendError(logs, 'manual-match', 'warning',
          `Pago verificado, error de API no permitió marcar automaticamente. Orden: #${order?.orderNumber}`,
          { orderId, storeId, storeName: store.storeName, orderNumber: order?.orderNumber }
        )
      }
    }

    console.log('[manual-match] result:', { platform, success: markSuccess, error: markError })

    if (!markSuccess) {
      appendError(logs, 'manual-match', 'error',
        `Error al marcar orden como pagada en ${platform}`,
        { orderId, storeId, storeName: store.storeName, orderNumber: order?.orderNumber, error: markError }
      )
      await saveLogs(logs)
      return NextResponse.json({ error: markError }, { status: 500 })
    }

    hot.unmatchedPayments.splice(unmatchedIndex, 1)
    incrementPersistedMonthStats(hot, payment.monto, 'emparejamiento')

    hot.recentMatches = hot.recentMatches ?? []
    hot.recentMatches.push({ mpPaymentId: payment.mpPaymentId, matchedAt: nowART(), orderId, storeId, order: order || undefined, payment })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'emparejamiento',
      triggeredBy: 'human',
      payment,
      order: order || undefined,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderTotal: order?.total,
      orderNumber: order?.orderNumber,
      orderId,
      storeId,
      storeName: store.storeName,
      customerName: order?.customerName,
      paymentReceivedAt: toUTCISO(payment.fechaPago),
      orderCreatedAt: order?.createdAt,
      hechoPor: auth.user.email,
    }
    await appendRegistroEntry(logEntry)

    appendActivity(logs, 'human', 'pago_emparejado', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order?.orderNumber,
      orderId,
      storeName: store.storeName,
    })
    auditMatch({ action: 'manual_match.paid', actor: 'human', component: 'api/manual-match', mpPaymentId: payment.mpPaymentId, orderId, orderNumber: order?.orderNumber, storeId, storeName: store.storeName, amount: payment.monto, result: 'success', message: `Match manual: ${payment.mpPaymentId} → #${order?.orderNumber}` })

    await saveLogs(logs)
    await saveHotState(hot)

    const recentMatch = { mpPaymentId: payment.mpPaymentId, matchedAt: logEntry.timestamp, orderId, storeId, order: order || undefined, payment }
    return NextResponse.json({ success: true, method: markMethod, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
