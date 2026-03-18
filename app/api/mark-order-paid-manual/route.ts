import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, getStores, incrementMonthlyStats, appendActivity } from '@/lib/storage'
import { markOrderAsPaid } from '@/lib/tiendanube'
import type { LogEntry, Payment } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { orderId, storeId, monto, medioPago, nombrePagador, cuitPagador, order: orderFromClient, fechaPago } = await req.json()
    if (!orderId || !storeId || !monto || !medioPago) {
      return NextResponse.json({ error: 'orderId, storeId, monto y medioPago son requeridos' }, { status: 400 })
    }

    const [state, stores] = await Promise.all([loadState(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    const tnResult = await markOrderAsPaid(storeId, store.accessToken, orderId)
    if (!tnResult.success) {
      return NextResponse.json({ error: tnResult.error }, { status: 500 })
    }

    const fakeMpPaymentId = `manual_${Date.now()}_${orderId}`
    // Usar la fecha/hora ingresada por el usuario; si no viene, usar el momento actual
    const now = fechaPago ? new Date(fechaPago).toISOString() : new Date().toISOString()

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

    // Acumulador mensual
    incrementMonthlyStats(state, Number(monto))

    // recentMatches: para que la orden quede verde en la pestaña Órdenes
    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({
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
    }
    state.matchLog.push(logEntry)

    appendActivity(state, 'human', 'orden_pagada_manual', {
      orderId,
      orderNumber: order?.orderNumber,
      storeName: store.storeName,
      monto: Number(monto),
      medioPago,
      nombrePagador: nombrePagador || order?.customerName,
    })

    await saveState(state)

    return NextResponse.json({ success: true, method: tnResult.method, logEntry })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
