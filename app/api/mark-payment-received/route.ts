import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ success: false, error: 'mpPaymentId requerido' }, { status: 400 })

    const state = await loadState()

    // Sacar de la cola de emparejamiento
    state.unmatchedPayments = state.unmatchedPayments.filter(
      u => u.mpPaymentId !== mpPaymentId && u.payment.mpPaymentId !== mpPaymentId
    )

    // Marcar como procesado para que no vuelva en el próximo sync
    if (!state.processedPayments.includes(mpPaymentId)) {
      state.processedPayments.push(mpPaymentId)
    }

    // Registrar como marcado externamente
    if (!state.externallyMarkedPayments.includes(mpPaymentId)) {
      state.externallyMarkedPayments.push(mpPaymentId)
    }

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
