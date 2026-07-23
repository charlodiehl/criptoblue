import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, getStores, incrementPersistedMonthStats, appendActivity, appendError, acquireLock, releaseLock } from '@/lib/storage'
import { appendRegistroEntry, isOrderAlreadyPaid } from '@/lib/registro'
import { markOrderAsPaid as markTNOrderAsPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyOrderAsPaid } from '@/lib/shopify'
import type { LogEntry, RecentMatch } from '@/lib/types'
import { auditMatch } from '@/lib/audit'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { nowART } from '@/lib/utils'

const LOCK_HOLDER = 'mark-order-paid'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }
    // Quién marca (trazabilidad): el proxy ya exige sesión; acá tomamos el email.
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const { storeId, orderId, total } = await req.json()
    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'storeId and orderId required' }, { status: 400 })
    }

    const [hot, logs, stores] = await Promise.all([
      loadHotState(), loadLogs(), getStores()
    ])
    const store = stores[storeId]
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    // Validación: la orden ya fue registrada como pagada
    if (await isOrderAlreadyPaid(orderId)) {
      return NextResponse.json({ error: 'Esta orden ya fue registrada como pagada' }, { status: 409 })
    }

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

    const now = nowART()
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
      orderTotal: total ?? undefined,
      hechoPor: auth.user.email,
    }
    await appendRegistroEntry(logEntry)
    if (total != null) incrementPersistedMonthStats(hot, total, 'manual_ordenes', storeId)

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
    auditMatch({ action: 'mark_order.paid', actor: 'human', component: 'api/mark-order-paid', mpPaymentId: fakeMpPaymentId, orderId, storeId, storeName: store.storeName, amount: total, result: 'success', message: 'Orden marcada pagada manualmente' })

    // El registro ya se insertó en registro_log (appendRegistroEntry).
    await saveLogs(logs)
    await saveHotState(hot)

    return NextResponse.json({ success: true, logEntry, recentMatch })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
