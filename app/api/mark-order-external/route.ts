import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'

const LOCK_HOLDER = 'mark-order-external'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ success: false, error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }

    const { orderId, storeId } = await req.json()
    if (!orderId || !storeId) return NextResponse.json({ success: false, error: 'orderId y storeId requeridos' }, { status: 400 })

    const key = `${storeId}-${orderId}`
    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

    if (!(hot.externallyMarkedOrders ?? []).includes(key)) {
      hot.externallyMarkedOrders = hot.externallyMarkedOrders ?? []
      hot.externallyMarkedOrders.push(key)
    }

    appendActivity(logs, 'human', 'orden_marcada_externa', { orderId, storeId })

    await Promise.all([saveHotState(hot), saveLogs(logs)])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
