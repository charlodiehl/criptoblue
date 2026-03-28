import { fetchAllPaymentsSince } from './mercadopago'
import { getPendingOrders as getTNOrders } from './tiendanube'
import { getPendingOrders as getShopifyOrders } from './shopify'
import { loadState, saveState, getStores, appendError } from './storage'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS } from './config'
import type { UnmatchedPayment, Store } from './types'

interface CycleResult {
  processed: number   // total pagos vistos en MP (puede incluir ya conocidos)
  newUnmatched: number // pagos verdaderamente nuevos agregados a la cola
  errors: string[]
  stores: Record<string, Store>
}

export async function processMPPayments(): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, newUnmatched: 0, errors: [] }

  const [state, stores] = await Promise.all([loadState(), getStores()])

  const now = new Date()
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  // Cutoffs separados para pagos y órdenes
  const sincePayments = cutoff48h > HARD_CUTOFF_PAYMENTS ? cutoff48h : HARD_CUTOFF_PAYMENTS
  const sinceOrders = cutoff48h > HARD_CUTOFF_ORDERS ? cutoff48h : HARD_CUTOFF_ORDERS

  // Purge pagos anteriores al cutoff efectivo de pagos
  const purgeCutoff = cutoff48h > HARD_CUTOFF_PAYMENTS ? cutoff48h : HARD_CUTOFF_PAYMENTS

  // Traer pagos aprobados desde el cutoff efectivo
  let payments
  try {
    payments = await fetchAllPaymentsSince(sincePayments)
  } catch (err) {
    result.errors.push(`MP fetch error: ${String(err)}`)
    appendError(state, 'mercadopago', 'error', `Error al traer pagos de MercadoPago: ${String(err)}`)
    await saveState(state)
    return result
  }

  const processedSet = new Set(state.processedPayments)
  const newPayments = payments.filter(p => !processedSet.has(p.mpPaymentId))
  result.processed = newPayments.length

  // IDs de pagos ya procesados (no deben reaparecer en la cola)
  // Incluye: confirmados via match y descartados.
  // Los externallyMarkedPayments ("no es de tiendas") se excluyen a propósito:
  // deben seguir en unmatchedPayments para que la pestaña Pagos los muestre en amarillo,
  // y el frontend los filtra de emparejamiento/sin-coincidencias via matchedPaymentIds.
  // Leer IDs confirmados de AMBOS logs (registroLog + matchLog) + retainedPaymentIds
  // registroLog: log permanente del UI
  // matchLog: log backend con expiración 48h (puede contener entradas que aún no están en registroLog)
  // retainedPaymentIds: backup de IDs preservados al borrar registro
  const confirmedIds = new Set<string>([
    ...state.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id),
    ...state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter((id): id is string => !!id),
    ...(state.retainedPaymentIds || []),
  ])

  const storeEntries = Object.values(stores)

  // Traer órdenes pendientes de todas las tiendas (TiendaNube y Shopify)
  // Usa cutoff de ÓRDENES: max(48h_ago, HARD_CUTOFF_ORDERS)
  const allOrdersPerStore = await Promise.allSettled(
    storeEntries.map(s => {
      const platform = s.platform ?? 'tiendanube'
      if (platform === 'shopify') {
        return getShopifyOrders(s.storeId, s.accessToken, s.storeName, sinceOrders)
      }
      return getTNOrders(s.storeId, s.accessToken, s.storeName, sinceOrders)
    })
  )
  allOrdersPerStore.forEach((r, i) => {
    if (r.status === 'rejected') {
      const platform = storeEntries[i].platform ?? 'tiendanube'
      result.errors.push(`${platform} fetch error store ${storeEntries[i].storeId}: ${r.reason}`)
      appendError(state, platform, 'warning',
        `Error al traer órdenes de tienda "${storeEntries[i].storeName}"`,
        { storeId: storeEntries[i].storeId, storeName: storeEntries[i].storeName, error: String(r.reason) }
      )
    }
  })

  // Nuevos pagos a agregar a la cola (colectados aparte para merge seguro al final)
  const newUnmatchedToAdd: UnmatchedPayment[] = []
  for (const payment of newPayments) {
    processedSet.add(payment.mpPaymentId)
    if (confirmedIds.has(payment.mpPaymentId)) continue

    newUnmatchedToAdd.push({
      payment,
      timestamp: new Date().toISOString(),
      mpPaymentId: payment.mpPaymentId,
    })
    result.newUnmatched++
  }

  // ─── Re-cargar estado fresco antes de guardar ──────────────────────────────
  // Evita race condition: si un usuario hizo match/dismiss mientras este ciclo
  // corría, sus cambios en unmatchedPayments quedarían sobreescritos si usamos
  // el state cargado al inicio. Recargamos y hacemos merge solo de lo nuevo.
  const freshState = await loadState()

  // 1. Purge en el estado fresco (eliminar pagos vencidos)
  freshState.unmatchedPayments = freshState.unmatchedPayments.filter(u => {
    const date = u.payment.fechaPago ? new Date(u.payment.fechaPago) : new Date(u.timestamp)
    return date >= purgeCutoff
  })

  // 2. Agregar nuevos pagos (sin duplicados)
  const freshUnmatchedIds = new Set(freshState.unmatchedPayments.map(u => u.payment.mpPaymentId))
  for (const u of newUnmatchedToAdd) {
    if (!freshUnmatchedIds.has(u.payment.mpPaymentId)) {
      freshState.unmatchedPayments.push(u)
    }
  }

  // 3. Aplicar paymentOverrides — solo sobre campos que MP trae vacíos
  const overrides = freshState.paymentOverrides || {}
  for (const u of freshState.unmatchedPayments) {
    const override = overrides[u.payment.mpPaymentId]
    if (!override) continue
    for (const [key, value] of Object.entries(override)) {
      const current = u.payment[key as keyof typeof u.payment]
      if ((!current || current === '') && value) {
        ;(u.payment as unknown as Record<string, unknown>)[key] = value
      }
    }
  }

  // 4. Limpiar overrides cuyos pagos ya vencieron (hacer acá, no en saveState, para no borrarlos durante el reset)
  if (freshState.paymentOverrides && Object.keys(freshState.paymentOverrides).length > 0) {
    const activeIds = new Set(freshState.unmatchedPayments.map(u => u.payment.mpPaymentId))
    for (const id of Object.keys(freshState.paymentOverrides)) {
      if (!activeIds.has(id)) delete freshState.paymentOverrides[id]
    }
  }

  // 5. Merge de processedPayments (unión de ambos sets)
  const mergedProcessed = new Set([...freshState.processedPayments, ...Array.from(processedSet)])
  freshState.processedPayments = Array.from(mergedProcessed)

  // 6. Campos exclusivos del ciclo
  freshState.lastMPCheck = now.toISOString()

  // 7. Actualizar cache de órdenes (si al menos una tienda respondió)
  const anyFulfilled = allOrdersPerStore.some(r => r.status === 'fulfilled')
  if (anyFulfilled) {
    freshState.cachedOrders = allOrdersPerStore.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    freshState.cachedOrdersAt = now.toISOString()
  }

  // 8. Merge de errorLog agregado en este ciclo
  const freshErrorIds = new Set(freshState.errorLog.map(e => e.id))
  for (const e of state.errorLog) {
    if (!freshErrorIds.has(e.id)) freshState.errorLog.push(e)
  }

  // 9. Merge de activityLog agregado en este ciclo
  const freshActivityIds = new Set(freshState.activityLog.map(a => a.id))
  for (const a of state.activityLog) {
    if (!freshActivityIds.has(a.id)) freshState.activityLog.push(a)
  }

  await saveState(freshState)

  result.stores = stores
  return result
}
