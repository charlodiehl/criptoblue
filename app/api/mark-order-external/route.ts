import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { orderId, storeId } = await req.json()
    if (!orderId || !storeId) return NextResponse.json({ success: false, error: 'orderId y storeId requeridos' }, { status: 400 })

    const key = `${storeId}-${orderId}`
    const state = await loadState()

    if (!state.externallyMarkedOrders.includes(key)) {
      state.externallyMarkedOrders.push(key)
    }

    appendActivity(state, 'human', 'orden_marcada_externa', { orderId, storeId })

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
