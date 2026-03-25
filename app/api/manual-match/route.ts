import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, incrementPersistedMonthStats, appendError, appendActivity } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid, getPendingOrders as getTNOrders } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid, getPendingOrders as getShopifyOrders } from '@/lib/shopify'
import { HARD_CUTOFF_ORDERS } from '@/lib/config'
import type { LogEntry } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId, orderId, storeId, order: orderFromClient } = await req.json()
    if (!mpPaymentId || !orderId || !storeId) {
      return NextResponse.json({ error: 'mpPaymentId, orderId, storeId required' }, { status: 400 })
    }

    const [state, stores] = await Promise.all([loadState(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const unmatchedIndex = state.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const unmatched = state.unmatchedPayments[unmatchedIndex]
    const payment = unmatched.payment

    // Usar la orden enviada por el cliente (ya la tiene en memoria).
    // Solo re-fetchear de TN si por algún motivo no vino en el body.
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

    if (platform === 'shopify') {
      const amount = order?.total ?? payment.monto
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, orderId, amount)
      markSuccess = result.success
      markError = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, orderId)
      markSuccess = result.success
      markError = result.error
      if (result.success && result.method === 'note') {
        console.warn('[manual-match] WARNING: TN returned 403/422 for payment_status change. Only a note was added. Order may NOT be marked paid in TiendaNube.')
        appendError(state, 'manual-match', 'warning',
          `TiendaNube no permitió cambiar el estado de la orden (403/422) — solo se agregó una nota. Marcala manualmente en TN.`,
          { orderId, storeId, storeName: store.storeName, orderNumber: order?.orderNumber }
        )
      }
    }

    console.log('[manual-match] result:', { platform, success: markSuccess, error: markError })

    if (!markSuccess) {
      appendError(state, 'manual-match', 'error',
        `Error al marcar orden como pagada en ${platform}`,
        { orderId, storeId, storeName: store.storeName, orderNumber: order?.orderNumber, error: markError }
      )
      await saveState(state)
      return NextResponse.json({ error: markError }, { status: 500 })
    }

    state.unmatchedPayments.splice(unmatchedIndex, 1)

    incrementPersistedMonthStats(state, payment.monto, 'emparejamiento')

    // recentMatches: para resaltado verde en pestañas (auto-limpia a las 24h, independiente del Registro)
    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({ mpPaymentId: payment.mpPaymentId, matchedAt: new Date().toISOString(), orderId, storeId, order: order || undefined, payment })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'manual_paid',
      source: 'emparejamiento',
      triggeredBy: 'human',
      payment,
      order: order || undefined,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderNumber: order?.orderNumber,
      orderId,
      storeId,
      storeName: store.storeName,
      customerName: order?.customerName,
      paymentReceivedAt: payment.fechaPago,
      orderCreatedAt: order?.createdAt,
    }
    state.registroLog.push(logEntry)
    state.matchLog.push(logEntry)

    appendActivity(state, 'human', 'pago_emparejado', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order?.orderNumber,
      orderId,
      storeName: store.storeName,
    })

    await saveState(state)

    const recentMatch = { mpPaymentId: payment.mpPaymentId, matchedAt: logEntry.timestamp, orderId, storeId, order: order || undefined, payment }
    return NextResponse.json({ success: true, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
