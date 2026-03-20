import { NextResponse } from 'next/server'
import { loadState, saveState, getStores, getMatchId, incrementMonthlyStats, appendError, appendActivity } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import { findAutoMatchCandidates } from '@/lib/auto-match'
import type { LogEntry } from '@/lib/types'

// Llamado por el cron 1 minuto después de cada sync (vercel.json)
// También puede llamarse manualmente vía POST
export async function POST() {
  try {
    const [state, stores] = await Promise.all([loadState(), getStores()])

    // Anti-duplicado: si ya corrió en los últimos 3 minutos, saltar
    const lastRun = state.lastAutoMatchAt ? new Date(state.lastAutoMatchAt).getTime() : 0
    const msSinceLastRun = Date.now() - lastRun
    if (msSinceLastRun < 3 * 60 * 1000) {
      return NextResponse.json({ skipped: true, reason: 'ran_recently', msSinceLastRun })
    }

    // IDs de pagos ya procesados (no volver a procesar)
    const confirmedIds = new Set<string>(
      state.matchLog
        .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'dismissed')
        .map(e => e.mpPaymentId)
        .filter(Boolean) as string[]
    )

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

      // Marcar como pagada en la plataforma
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

      // Quitar de unmatchedPayments
      const idx = state.unmatchedPayments.findIndex(u => getMatchId(u) === candidate.mpPaymentId)
      if (idx >= 0) state.unmatchedPayments.splice(idx, 1)

      // Acumulador mensual
      incrementMonthlyStats(state, candidate.payment.monto)

      // recentMatches
      state.recentMatches = state.recentMatches || []
      state.recentMatches.push({
        mpPaymentId: candidate.mpPaymentId,
        matchedAt: new Date().toISOString(),
        orderId: candidate.orderId,
        storeId: candidate.storeId,
        order: candidate.order,
        payment: candidate.payment,
      })

      // Log entry
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        action: 'manual_paid',
        source: 'emparejamiento',
        payment: candidate.payment,
        order: candidate.order,
        mpPaymentId: candidate.mpPaymentId,
        amount: candidate.payment.monto,
        orderNumber: candidate.order.orderNumber,
        orderId: candidate.orderId,
        storeId: candidate.storeId,
        storeName: store.storeName,
        customerName: candidate.order.customerName,
      }
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
    await saveState(state)

    console.log(`[auto-match-run] matched: ${matched}, errors: ${errors.length}`)
    return NextResponse.json({ success: true, matched, errors: errors.length > 0 ? errors : undefined })
  } catch (err) {
    console.error('[auto-match-run] fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET para health check / verificación manual
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'auto-match-run', time: new Date().toISOString() })
}
