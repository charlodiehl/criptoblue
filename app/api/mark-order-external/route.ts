import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { orderId, storeId } = await req.json()
    if (!orderId || !storeId) return NextResponse.json({ success: false, error: 'orderId y storeId requeridos' }, { status: 400 })

    const key = `${storeId}-${orderId}`
    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

    if (!(hot.externallyMarkedOrders ?? []).includes(key)) { // #12: fallback defensivo
      hot.externallyMarkedOrders = hot.externallyMarkedOrders ?? []
      hot.externallyMarkedOrders.push(key)
    }

    appendActivity(logs, 'human', 'orden_marcada_externa', { orderId, storeId })

    await Promise.all([saveHotState(hot), saveLogs(logs)])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
