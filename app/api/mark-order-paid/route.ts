import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, loadMatchLog, saveMatchLog, getStores, incrementPersistedMonthStats, appendActivity, appendError } from '@/lib/storage'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, RecentMatch } from '@/lib/types'

// #6: Agrega appendActivity y appendError para consistencia con el resto de endpoints
export async function POST(req: NextRequest) {
  try {
    const { storeId, orderId, total } = await req.json()
    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'storeId and orderId required' }, { status: 400 })
    }

    const [hot, logs, matchLogData, stores] = await Promise.all([
      loadHotState(), loadLogs(), loadMatchLog(), getStores()
    ])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const platform = store.platform ?? 'tiendanube'

    let success: boolean
    let error: string | undefined

    if (platform === 'shopify') {
      if (!total && total !== 0) {
        return NextResponse.json({ error: 'total required for Shopify orders' }, { status: 400 })
      }
      const result = await markShopifyOrderAsPaid(storeId, store.accessToken, orderId, total)
      success = result.success
      error = result.error
    } else {
      const result = await markTNOrderAsPaid(storeId, store.accessToken, orderId)
      success = result.success
      error = result.error
    }

    if (!success) {
      appendError(logs, 'mark-order-paid', 'error',
        `Error al marcar orden como pagada manualmente en ${platform}`,
        { orderId, storeId, storeName: store.storeName, error }
      )
      await saveLogs(logs)
      return NextResponse.json({ error }, { status: 500 })
    }

    const now = new Date().toISOString()
    const fakeMpPaymentId = `manual_paid_${Date.now()}_${orderId}`

    const logEntry: LogEntry = {
      timestamp: now,
      action: 'manual_paid',
      source: 'manual_ordenes',
      triggeredBy: 'human',
      orderId,
      storeId,
      storeName: store.storeName,
      amount: total ?? undefined,
    }
    logs.registroLog.push(logEntry)
    matchLogData.matchLog.push(logEntry)
    if (total != null) incrementPersistedMonthStats(hot, total, 'manual_ordenes')

    // recentMatches: para que la orden quede verde en la pestaña Órdenes
    const recentMatch: RecentMatch = {
      mpPaymentId: fakeMpPaymentId,
      matchedAt: now,
      orderId,
      storeId,
    }
    hot.recentMatches = hot.recentMatches || []
    hot.recentMatches.push(recentMatch)

    appendActivity(logs, 'human', 'orden_marcada_pagada_manual', {
      orderId,
      storeId,
      storeName: store.storeName,
      amount: total,
    })

    await Promise.all([saveHotState(hot), saveLogs(logs), saveMatchLog(matchLogData)])

    return NextResponse.json({ success: true, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
