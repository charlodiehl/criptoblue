import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }

    const state = await loadState()
    if (!state.dismissedOrders.includes(orderId)) {
      state.dismissedOrders.push(orderId)
    }
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
