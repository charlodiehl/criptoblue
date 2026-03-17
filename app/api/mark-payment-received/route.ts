import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState, appendActivity } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { mpPaymentId } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ success: false, error: 'mpPaymentId requerido' }, { status: 400 })

    const state = await loadState()

    // El pago se QUEDA en unmatchedPayments para seguir visible en la pestaña Pagos
    // (con badge amarillo "NO ES TIENDAS"). Solo se saca de Sin coincidencia via externallyMarkedPayments.
    const payment = state.unmatchedPayments.find(
      u => u.mpPaymentId === mpPaymentId || u.payment.mpPaymentId === mpPaymentId
    )?.payment

    // Marcar como procesado para que no vuelva en el próximo sync
    if (!state.processedPayments.includes(mpPaymentId)) {
      state.processedPayments.push(mpPaymentId)
    }

    // Registrar como marcado externamente con timestamp (para que expire a las 48h igual que el resto)
    if (!state.externallyMarkedPayments.some(e => e.id === mpPaymentId)) {
      state.externallyMarkedPayments.push({ id: mpPaymentId, markedAt: new Date().toISOString() })
    }

    appendActivity(state, 'human', 'pago_marcado_recibido', {
      mpPaymentId,
      monto: payment?.monto,
    })

    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
