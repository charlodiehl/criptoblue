import { NextResponse } from 'next/server'
import { loadState, saveState, getStores, incrementPersistedMonthStats, appendError, appendActivity } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import { findAutoMatchCandidates } from '@/lib/auto-match'
import type { LogEntry } from '@/lib/types'

export const maxDuration = 60

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  const bearer = req.headers.get('authorization')
  const custom = req.headers.get('x-cron-secret')
  return bearer === `Bearer ${cronSecret}` || custom === cronSecret
}

async function runAutoMatch(triggeredBy: 'cron' | 'manual_button') {
  const [state, stores] = await Promise.all([loadState(), getStores()])

  // Verificar que el sync corrió ANTES que este auto-match y que hayan pasado ≥30s
  // (garantiza que los datos están frescos antes de buscar candidatos)
  const lastSync = state.lastMPCheck ? new Date(state.lastMPCheck).getTime() : 0
  const lastRun  = state.lastAutoMatchAt ? new Date(state.lastAutoMatchAt).getTime() : 0
  const now = Date.now()

  // Si ya corrió después del último sync, no volver a correr
  if (lastRun > lastSync) {
    return NextResponse.json({ skipped: true, reason: 'already_ran_after_sync', lastRun: state.lastAutoMatchAt, lastSync: state.lastMPCheck })
  }
  // El sync debe haber terminado hace al menos 30s para que los datos estén guardados
  if (lastSync === 0 || (now - lastSync) < 30 * 1000) {
    return NextResponse.json({ skipped: true, reason: 'sync_too_recent_or_never', msSinceSync: now - lastSync })
  }

  // IDs de pagos ya procesados (no volver a procesar)
  // Lee de AMBOS logs + retainedPaymentIds para máxima protección
  const confirmedIds = new Set<string>([
    ...state.registroLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...state.matchLog
      .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
      .map(e => e.mpPaymentId)
      .filter(Boolean) as string[],
    ...(state.retainedPaymentIds || []),
  ])

  const candidates = findAutoMatchCandidates(
    state.unmatchedPayments,
    state.cachedOrders || [],
    state.dismissedPairs || [],
    confirmedIds,
  )

  if (candidates.length === 0) {
    state.lastAutoMatchAt = new Date().toISOString()
    await saveState(state)
    return NextResponse.json({ success: true, matched: 0 })
  }

  let matched = 0
  const errors: string[] = []

  for (const candidate of candidates) {
    const store = stores[candidate.storeId]
    if (!store) continue

    const platform = store.platform ?? 'tiendanube'
    let markSuccess = false
    let markError: string | undefined

    try {
      if (platform === 'shopify') {
        const result = await markShopifyOrderAsPaid(candidate.storeId, store.accessToken, candidate.orderId, candidate.order.total)
        markSuccess = result.success
        markError = result.error
      } else {
        const result = await markTNOrderAsPaid(candidate.storeId, store.accessToken, candidate.orderId)
        markSuccess = result.success
        markError = result.error
        if (result.success && result.method === 'note') {
          appendError(state, 'auto-match', 'warning',
            `TiendaNube no permitió cambiar estado (403/422) — solo se agregó nota. Orden: #${candidate.order.orderNumber}`,
            { orderId: candidate.orderId, storeId: candidate.storeId, storeName: store.storeName }
          )
        }
      }
    } catch (err) {
      markError = String(err)
    }

    if (!markSuccess) {
      appendError(state, 'auto-match', 'error',
        `Error al marcar orden #${candidate.order.orderNumber} como pagada (auto-match)`,
        { orderId: candidate.orderId, storeId: candidate.storeId, error: markError }
      )
      errors.push(`${candidate.orderId}: ${markError}`)
      continue
    }

    const idx = state.unmatchedPayments.findIndex(u => (u.mpPaymentId || u.payment?.mpPaymentId || '') === candidate.mpPaymentId)
    if (idx >= 0) state.unmatchedPayments.splice(idx, 1)

    incrementPersistedMonthStats(state, candidate.payment.monto, 'emparejamiento')

    state.recentMatches = state.recentMatches || []
    state.recentMatches.push({
      mpPaymentId: candidate.mpPaymentId,
      matchedAt: new Date().toISOString(),
      orderId: candidate.orderId,
      storeId: candidate.storeId,
      order: candidate.order,
      payment: candidate.payment,
    })

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      action: 'auto_paid',
      source: 'emparejamiento',
      triggeredBy,
      payment: candidate.payment,
      order: candidate.order,
      mpPaymentId: candidate.mpPaymentId,
      amount: candidate.payment.monto,
      orderNumber: candidate.order.orderNumber,
      orderId: candidate.orderId,
      storeId: candidate.storeId,
      storeName: store.storeName,
      customerName: candidate.order.customerName,
      paymentReceivedAt: candidate.payment.fechaPago,
      orderCreatedAt: candidate.order.createdAt,
    }
    state.registroLog.push(logEntry)
    state.matchLog.push(logEntry)

    appendActivity(state, 'system', 'pago_auto_emparejado', {
      mpPaymentId: candidate.mpPaymentId,
      monto: candidate.payment.monto,
      orderNumber: candidate.order.orderNumber,
      orderId: candidate.orderId,
      storeName: store.storeName,
    })

    matched++
  }

  state.lastAutoMatchAt = new Date().toISOString()
  state.lastAutoMatchMatched = matched
  await saveState(state)

  console.log(`[auto-match-run] matched: ${matched}, errors: ${errors.length}`)
  return NextResponse.json({ success: true, matched, errors: errors.length > 0 ? errors : undefined })
}

// GET — disparado por el cron de Vercel (1 min después del sync)
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runAutoMatch('cron')
  } catch (err) {
    console.error('[auto-match-run] fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — disparo manual desde el botón ⚡ del browser
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runAutoMatch('manual_button')
  } catch (err) {
    console.error('[auto-match-run] fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
