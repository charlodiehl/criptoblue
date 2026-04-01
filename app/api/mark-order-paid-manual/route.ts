import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, getStores, incrementPersistedMonthStats, appendActivity } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Payment } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { orderId, storeId, monto, medioPago, nombrePagador, cuitPagador, order: orderFromClient, fechaPago } = await req.json()
    if (!orderId || !storeId || !monto || !medioPago) {
      return NextResponse.json({ error: 'orderId, storeId, monto y medioPago son requeridos' }, { status: 400 })
    }

    const [hot, logs, matchLogData, stores] = await Promise.all([
      loadHotState(), loadLogs(), loadMatchLog(), getStores()
    ])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Marcar como pagada en la plataforma correspondiente
    const platform = store.platform ?? 'tiendanube'
    let markSuccess: boolean
    let markError: string | undefined

    if (platform === 'shopify') {
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, orderId, Number(monto))
      markSuccess = result.success
      markError = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, orderId)
      markSuccess = result.success
      markError = result.error
    }

    if (!markSuccess) {
      return NextResponse.json({ error: markError }, { status: 500 })
    }

    const fakeMpPaymentId = `manual_${Date.now()}_${orderId}`
    // Usar la fecha/hora ingresada por el usuario; si no viene, usar el momento actual
    // fechaPago viene del input datetime-local del browser en horario Argentina (UTC-3), sin zona horaria.
    // Se agrega ':00-03:00' para que new Date() lo interprete correctamente como ART y no como UTC.
    const now = fechaPago ? new Date(fechaPago + ':00-03:00').toISOString() : new Date().toISOString()

    // Payment sintético con los datos ingresados por el usuario
    const fakePayment: Payment = {
      mpPaymentId: fakeMpPaymentId,
      monto: Number(monto),
      nombrePagador: nombrePagador || '',
      emailPagador: '',
      cuitPagador: cuitPagador || '',
      referencia: '',
      operationId: '',
      metodoPago: medioPago,
      fechaPago: now,
      status: 'approved',
      source: medioPago,
      rawData: {},
    }

    const order = orderFromClient || null

    incrementPersistedMonthStats(hot, Number(monto), 'manual_ordenes')

    // recentMatches: para que la orden quede verde en la pestaña Órdenes
    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId: fakeMpPaymentId,
      matchedAt: now,
      orderId,
      storeId,
      order: order || undefined,
      payment: fakePayment,
    })

    const logEntry: LogEntry = {
      timestamp: now,
      action: 'manual_paid',
      source: 'manual_ordenes',
      triggeredBy: 'human',
      payment: fakePayment,
      order: order || undefined,
      mpPaymentId: fakeMpPaymentId,
      amount: Number(monto),
      orderNumber: order?.orderNumber,
      orderId,
      storeId,
      storeName: store.storeName,
      customerName: nombrePagador || order?.customerName,
      cuitPagador: cuitPagador || undefined,
      orderCreatedAt: order?.createdAt,
    }
    logs.registroLog.push(logEntry)
    matchLogData.matchLog.push(logEntry)

    appendActivity(logs, 'human', 'orden_pagada_manual', {
      orderId,
      orderNumber: order?.orderNumber,
      storeName: store.storeName,
      monto: Number(monto),
      medioPago,
      nombrePagador: nombrePagador || order?.customerName,
    })

    // registroLog primero — es la fuente de verdad; si falla, el endpoint devuelve error
    await saveLogs(logs)
    await Promise.all([saveHotState(hot), saveMatchLog(matchLogData)])

    return NextResponse.json({ success: true, logEntry, recentMatch: { mpPaymentId: fakeMpPaymentId, matchedAt: now, orderId, storeId } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
