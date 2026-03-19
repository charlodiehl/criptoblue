import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId, orderId, storeId } = await req.json()
    if (!mpPaymentId || !orderId || !storeId) {
      return NextResponse.json({ error: 'mpPaymentId, orderId y storeId son requeridos' }, { status: 400 })
    }

    const state = await loadState()

    // Agregar a la blacklist de pares solo si no existe ya
    const yaExiste = (state.dismissedPairs || []).some(
      p => p.mpPaymentId === mpPaymentId && p.orderId === orderId && p.storeId === storeId
    )
    if (!yaExiste) {
      state.dismissedPairs = state.dismissedPairs || []
      state.dismissedPairs.push({ mpPaymentId, orderId, storeId, dismissedAt: new Date().toISOString() })
    }

    // El pago y la orden NO se eliminan — siguen disponibles para otros emparejamientos
    appendActivity(state, 'human', 'par_descartado', { mpPaymentId, orderId, storeId })
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
