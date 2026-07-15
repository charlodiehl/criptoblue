import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid } from '@/lib/registro'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, Payment } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { requireUser } from '@/lib/auth/server'
import { nowART, toUTCISO } from '@/lib/utils'

const LOCK_HOLDER = 'mark-order-paid-manual'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }
    // Quién carga el pago (trazabilidad). El proxy ya exige sesión; acá tomamos el email.
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    const { orderId, storeId, monto, medioPago, nombrePagador, cuitPagador, order: orderFromClient, fechaPago, billetera, billeteraOtra } = await req.json()
    if (!orderId || !storeId || !monto || !medioPago) {
      return NextResponse.json({ error: 'orderId, storeId, monto y medioPago son requeridos' }, { status: 400 })
    }

    // Billetera del pago: MF/Lacar/MS/Montemar (source = el nombre de la billetera),
    // "Otras" con nombre libre (source = `otras:<nombre>`), o sin elegir → el medio
    // de pago (comportamiento viejo). El source es lo que atribuye el pago a la billetera.
    const billeteraSel = String(billetera || '').trim()
    const nombreOtras = String(billeteraOtra || '').trim()
    const source = billeteraSel === 'Otras'
      ? `otras:${nombreOtras}`
      : (billeteraSel || medioPago)

    const [hot, logs, stores] = await Promise.all([
      loadHotState(), loadLogs(), getStores()
    ])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Validación: la orden ya fue registrada como pagada
    if (await isOrderAlreadyPaid(orderId)) {
      return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
    }

    const fakeMpPaymentId = `manual_${Date.now()}_${orderId}`
    // entryTimestamp: momento real en que se ejecuta la acción (para el log).
    const entryTimestamp = nowART()
    // fechaPagoISO: fecha/hora del pago ingresada por el usuario (para payment.fechaPago).
    // fechaPago viene del input datetime-local del browser en horario Argentina (UTC-3), sin zona horaria.
    // Se agrega ':00-03:00' para que new Date() lo interprete correctamente como ART y no como UTC.
    const fechaPagoISO = fechaPago ? new Date(fechaPago + ':00-03:00').toISOString() : entryTimestamp

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
      fechaPago: fechaPagoISO,
      status: 'approved',
      source,
      rawData: {},
    }

    const order = orderFromClient || null

    incrementPersistedMonthStats(hot, Number(monto), 'manual_ordenes')

    // recentMatches: para que la orden quede verde en la pestaña Órdenes
    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push({
      mpPaymentId: fakeMpPaymentId,
      matchedAt: entryTimestamp,
      orderId,
      storeId,
      order: order || undefined,
      payment: fakePayment,
    })

    const logEntry: LogEntry = {
      timestamp: entryTimestamp,
      action: 'manual_paid',
      source: 'manual_ordenes',
      triggeredBy: 'human',
      payment: fakePayment,
      order: order || undefined,
      mpPaymentId: fakeMpPaymentId,
      amount: Number(monto),
      orderTotal: order?.total,
      orderNumber: order?.orderNumber,
      orderId,
      storeId,
      storeName: store.storeName,
      customerName: nombrePagador || order?.customerName,
      cuitPagador: cuitPagador || undefined,
      paymentReceivedAt: toUTCISO(fechaPagoISO),
      orderCreatedAt: order?.createdAt,
      hechoPor: auth.user.email,
    }
    // Write-ahead: insertar el registro ANTES de marcar en la plataforma.
    await appendRegistroEntry(logEntry)

    appendActivity(logs, 'human', 'orden_pagada_manual', {
      orderId,
      orderNumber: order?.orderNumber,
      storeName: store.storeName,
      monto: Number(monto),
      medioPago,
      nombrePagador: nombrePagador || order?.customerName,
    })
    auditMatch({ action: 'mark_order_manual.paid', actor: 'human', component: 'api/mark-order-paid-manual', mpPaymentId: fakeMpPaymentId, orderId, orderNumber: order?.orderNumber, storeId, storeName: store.storeName, amount: Number(monto), result: 'success', message: `Orden pagada manual: ${nombrePagador || ''}` })

    // Persistir activityLog (el registro ya se insertó arriba con appendRegistroEntry).
    await saveLogs(logs)

    // Marcar como pagada en la plataforma
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
      // El log ya fue guardado — devolver success con advertencia para que el
      // frontend lo informe al usuario sin bloquear el flujo.
      await saveHotState(hot)
      return NextResponse.json({ success: true, logEntry, tnError: markError, recentMatch: { mpPaymentId: fakeMpPaymentId, matchedAt: entryTimestamp, orderId, storeId } })
    }

    await saveHotState(hot)

    return NextResponse.json({ success: true, logEntry, recentMatch: { mpPaymentId: fakeMpPaymentId, matchedAt: entryTimestamp, orderId, storeId } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
