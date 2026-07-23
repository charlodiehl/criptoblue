import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, setUnidad } from '@/lib/auth/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendError, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid, isPaymentAlreadyUsed } from '@/lib/registro'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { sanearConcepto, usarConcepto } from '@/lib/conceptos'
import type { LogEntry } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { notifyAdmins } from '@/lib/push'
import { nowART, toUTCISO } from '@/lib/utils'

const LOCK_HOLDER = 'tienda-reclamar'

// POST /api/tienda/reclamar — { mpPaymentId, orderNumber, storeId? }
//
// Una tienda "reclama" un pago pendiente que encontró con Buscar Pagos: indica
// el número de orden y la app valida y ejecuta el mismo flujo que un
// emparejamiento manual (decisión del usuario):
//  1. La orden debe EXISTIR en la tienda (búsqueda directa en la plataforma,
//     sin límite de antigüedad).
//  2. Guards de idempotencia: orden no registrada, pago no usado, pago en cola.
//  3. Se marca pagada en TiendaNube/Shopify; si la plataforma falla NO se
//     registra (criterio conservador, igual que manual-match).
//  4. Registro con source='tienda_buscar' (alimenta el feed del admin) y stats
//     al bucket EMPAREJADO (el volumen reclamado cuenta como automatizado).
//  5. El movimiento de ingreso al balance lo crea el hook de appendRegistroEntry.
//
// storeId: rol tienda usa SIEMPRE el suyo (resolveStoreScope ignora el request);
// el admin lo manda en la vista espejo — se acepta tanto en la query (?storeId=,
// como lo agrega BuscarPagosTab) como en el body, para no depender de dónde venga.
export async function POST(req: NextRequest) {
  let locked = false
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const { user } = auth

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const { mpPaymentId, orderNumber } = body
    if (!mpPaymentId || !orderNumber) {
      return NextResponse.json({ error: 'mpPaymentId y orderNumber son requeridos' }, { status: 400 })
    }
    // Si la orden no existe en la tienda, `forzar` habilita la adjudicación PENDIENTE
    // (sujeta a confirmación del admin). Sin el flag, se le avisa y no se registra.
    const forzar = body.forzar === true

    const storeId = resolveStoreScope(user, req.nextUrl.searchParams.get('storeId') || body.storeId)
    if (!storeId) {
      return NextResponse.json({ error: 'No hay tienda asignada para esta operación' }, { status: 400 })
    }

    locked = await acquireLock(LOCK_HOLDER, `reclamo ${mpPaymentId} por ${user.email}`, 30_000)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos y volvé a intentar.' }, { status: 409 })
    }

    const [hot, logs, stores] = await Promise.all([loadHotState(), loadLogs(), getStores()])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // El pago tiene que seguir en la cola (pudo tomarlo el auto-match hace segundos)
    const unmatchedIndex = hot.unmatchedPayments.findIndex(
      u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === mpPaymentId
    )
    if (unmatchedIndex < 0) {
      return NextResponse.json({ error: 'Ese pago ya no está pendiente (puede haberse emparejado recién). Actualizá la búsqueda.' }, { status: 409 })
    }
    const payment = hot.unmatchedPayments[unmatchedIndex].payment

    // La orden debe existir en ESTA tienda — búsqueda directa, sin límite de 48hs
    let encontrada
    try {
      encontrada = await buscarOrdenEnTienda(store, String(orderNumber))
    } catch (err) {
      return NextResponse.json({ error: `No se pudo consultar la tienda: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }
    if (!encontrada) {
      // La orden NO existe en la tienda. Sin `forzar`, se le avisa a la tienda para
      // que decida (la validación quedará sujeta a confirmación del admin).
      if (!forzar) {
        return NextResponse.json({
          needsConfirmation: true,
          orderNumber: String(orderNumber),
          message: `No se encontró la orden "${orderNumber}" en ${store.storeName}. Si la aceptás, la adjudicación queda sujeta a confirmación del administrador.`,
        })
      }

      // ── Camino B: adjudicación PENDIENTE ──────────────────────────────────────
      // Se registra igual (suma al saldo y al volumen del mes), SIN marcar nada en
      // la plataforma (no hay orden). Queda 'pendiente' hasta que el admin confirme
      // o rechace. Único guard: el pago no puede estar ya usado.
      if (await isPaymentAlreadyUsed(mpPaymentId)) {
        return NextResponse.json({ error: 'Ese pago ya fue utilizado con otra orden' }, { status: 409 })
      }

      hot.unmatchedPayments.splice(unmatchedIndex, 1)
      incrementPersistedMonthStats(hot, payment.monto, 'emparejamiento', storeId)
      hot.recentMatches = hot.recentMatches ?? []
      hot.recentMatches.push({ mpPaymentId: payment.mpPaymentId, matchedAt: nowART(), storeId, payment })

      // Concepto opcional: el reclamo NO es una venta (la orden no existe), así que la
      // tienda le pone una etiqueta libre. El texto que tipeó (orderNumber) es la etiqueta;
      // el concepto va aparte. En el registro se ven los dos ("Mayorista · Impuestos").
      const conceptoReclamo = sanearConcepto(body.concepto)
      const pendingEntry: LogEntry = {
        timestamp: nowART(),
        action: 'manual_paid',
        source: 'tienda_buscar',
        triggeredBy: 'human',
        adjudicacion: 'pendiente',
        payment,
        mpPaymentId: payment.mpPaymentId,
        amount: payment.monto,
        orderNumber: String(orderNumber),   // el texto que tipeó la tienda (no existe como orden)
        storeId,
        storeName: store.storeName,
        customerName: payment.nombrePagador,
        paymentReceivedAt: toUTCISO(payment.fechaPago),
        hechoPor: user.email,
        concepto: conceptoReclamo || null,
      }
      await appendRegistroEntry(pendingEntry)
      if (conceptoReclamo) { try { await usarConcepto(storeId, conceptoReclamo) } catch { /* lista secundaria */ } }

      appendActivity(logs, 'human', 'tienda_adjudicacion_pendiente', {
        mpPaymentId: payment.mpPaymentId, monto: payment.monto, orderNumber: String(orderNumber),
        storeName: store.storeName, reclamadoPor: user.email,
      })
      await saveLogs(logs)
      await saveHotState(hot)

      try {
        const montoTxt = Number(payment.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const pagador = payment.nombrePagador ? ` de ${payment.nombrePagador}` : ''
        await notifyAdmins('adjudicacion_revision', {
          title: 'Adjudicación a revisar',
          body: `${store.storeName} adjudicó un pago${pagador} de ${montoTxt} ARS con un N° de orden que no existe ("${orderNumber}"). Confirmá o rechazá.`,
          url: '/finanzas',
        })
      } catch { /* best-effort */ }

      return NextResponse.json({ success: true, pendiente: true, orderNumber: String(orderNumber), storeName: store.storeName, monto: payment.monto })
    }
    const order = encontrada.order

    // Estado en la PLATAFORMA: no reclamar una orden cancelada ni una ya pagada.
    // isOrderAlreadyPaid solo mira registro_log, así que no detecta órdenes que se
    // marcaron pagadas fuera de la app (directo en TiendaNube/Shopify) — ese fue el
    // agujero por el que un reclamo re-emparejó una orden ya resuelta.
    const pagoStatus = (encontrada.paymentStatus || '').toLowerCase()
    const ordenStatus = (encontrada.orderStatus || '').toLowerCase()
    if (ordenStatus === 'cancelled') {
      auditMatch({ action: 'tienda_reclamo.order_cancelled_blocked', actor: 'human', component: 'api/tienda/reclamar', mpPaymentId, orderId: order.orderId, orderNumber: String(orderNumber), storeId, storeName: store.storeName, amount: payment.monto, result: 'skipped', message: `Orden cancelada: #${order.orderNumber} (reclamo de ${user.email})` })
      return NextResponse.json({ error: `La orden #${order.orderNumber} está cancelada, no se puede reclamar.` }, { status: 409 })
    }
    if (pagoStatus === 'paid') {
      auditMatch({ action: 'tienda_reclamo.order_paid_in_platform_blocked', actor: 'human', component: 'api/tienda/reclamar', mpPaymentId, orderId: order.orderId, orderNumber: String(orderNumber), storeId, storeName: store.storeName, amount: payment.monto, result: 'skipped', message: `Orden ya pagada en la plataforma: #${order.orderNumber} (reclamo de ${user.email})` })
      return NextResponse.json({ error: `La orden #${order.orderNumber} ya figura pagada en ${store.storeName}, no se puede reclamar.` }, { status: 409 })
    }

    // Guards de idempotencia (mismos que manual-match)
    if (await isOrderAlreadyPaid(order.orderId)) {
      auditMatch({ action: 'tienda_reclamo.order_already_paid_blocked', actor: 'human', component: 'api/tienda/reclamar', mpPaymentId, orderId: order.orderId, orderNumber: String(orderNumber), storeId, storeName: store.storeName, amount: payment.monto, result: 'skipped', message: `Orden ya registrada: ${order.orderId} (reclamo de ${user.email})` })
      return NextResponse.json({ error: 'Esa orden ya está registrada como pagada' }, { status: 409 })
    }
    if (await isPaymentAlreadyUsed(mpPaymentId)) {
      auditMatch({ action: 'tienda_reclamo.payment_already_used_blocked', actor: 'human', component: 'api/tienda/reclamar', mpPaymentId, orderId: order.orderId, orderNumber: String(orderNumber), storeId, storeName: store.storeName, amount: payment.monto, result: 'skipped', message: `Pago ya emparejado: ${mpPaymentId} (reclamo de ${user.email})` })
      return NextResponse.json({ error: 'Ese pago ya fue utilizado con otra orden' }, { status: 409 })
    }

    // Marcar pagada en la plataforma. Si falla, NO se registra (conservador).
    const platform = store.platform ?? 'tiendanube'
    let markSuccess: boolean
    let markError: string | undefined
    if (platform === 'shopify') {
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, order.orderId, order.total ?? payment.monto)
      markSuccess = result.success
      markError = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, order.orderId)
      markSuccess = result.success
      markError = result.error
      if (result.success && result.method === 'note') {
        appendError(logs, 'tienda-reclamar', 'warning',
          `Reclamo verificado, pero la API de TN no permitió marcar la orden automáticamente. Orden: #${order.orderNumber}`,
          { orderId: order.orderId, storeId, storeName: store.storeName, orderNumber: order.orderNumber })
      }
    }

    if (!markSuccess) {
      appendError(logs, 'tienda-reclamar', 'error',
        `Error al marcar la orden como pagada en ${platform} (reclamo de tienda)`,
        { orderId: order.orderId, storeId, storeName: store.storeName, orderNumber: order.orderNumber, error: markError })
      await saveLogs(logs)
      return NextResponse.json({ error: `No se pudo marcar la orden en la tienda: ${markError}` }, { status: 500 })
    }

    // Persistencia (mismo orden que manual-match)
    hot.unmatchedPayments.splice(unmatchedIndex, 1)
    // Decisión del usuario: el volumen reclamado por tiendas suma al bucket EMPAREJADO
    incrementPersistedMonthStats(hot, payment.monto, 'emparejamiento', storeId)

    hot.recentMatches = hot.recentMatches ?? []
    hot.recentMatches.push({ mpPaymentId: payment.mpPaymentId, matchedAt: nowART(), orderId: order.orderId, storeId, order, payment })

    const logEntry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'tienda_buscar',
      triggeredBy: 'human',
      payment,
      order,
      mpPaymentId: payment.mpPaymentId,
      amount: payment.monto,
      orderTotal: order.total,
      orderNumber: order.orderNumber,
      orderId: order.orderId,
      storeId,
      storeName: store.storeName,
      customerName: order.customerName,
      paymentReceivedAt: toUTCISO(payment.fechaPago),
      orderCreatedAt: order.createdAt,
      hechoPor: user.email,   // usuario de la tienda que reclamó el pago
    }
    await appendRegistroEntry(logEntry)

    appendActivity(logs, 'human', 'tienda_reclamo_pago', {
      mpPaymentId: payment.mpPaymentId,
      monto: payment.monto,
      orderNumber: order.orderNumber,
      storeName: store.storeName,
      reclamadoPor: user.email,
    })
    auditMatch({ action: 'tienda_reclamo.paid', actor: 'human', component: 'api/tienda/reclamar', mpPaymentId: payment.mpPaymentId, orderId: order.orderId, orderNumber: order.orderNumber, storeId, storeName: store.storeName, amount: payment.monto, result: 'success', message: `Reclamo de tienda: ${payment.mpPaymentId} → #${order.orderNumber} (${user.email})` })

    await saveLogs(logs)
    await saveHotState(hot)

    // Notificar a los administradores para que corroboren el emparejamiento (best-effort).
    try {
      const montoTxt = Number(payment.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const pagador = payment.nombrePagador ? ` de ${payment.nombrePagador}` : ''
      await notifyAdmins('pago_adjudicado', {
        title: 'Pago adjudicado por una tienda',
        body: `${store.storeName} adjudicó un pago${pagador} de ${montoTxt} ARS a la orden #${order.orderNumber}. Corroborá el emparejamiento.`,
        url: '/finanzas',
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true, orderNumber: order.orderNumber, storeName: store.storeName, monto: payment.monto })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    if (locked) await releaseLock(LOCK_HOLDER)
  }
}
