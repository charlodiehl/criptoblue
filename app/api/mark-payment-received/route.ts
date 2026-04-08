import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadProcessed, saveProcessed, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'
import { audit } from '@/lib/audit'

const LOCK_HOLDER = 'mark-payment-received'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ success: false, error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }

    const { mpPaymentId } = await req.json()
    if (!mpPaymentId) return NextResponse.json({ success: false, error: 'mpPaymentId requerido' }, { status: 400 })

    const [hot, processed, logs] = await Promise.all([loadHotState(), loadProcessed(), loadLogs()])

    const payment = hot.unmatchedPayments.find(
      u => u.mpPaymentId === mpPaymentId || u.payment.mpPaymentId === mpPaymentId
    )?.payment

    if (!processed.processedPayments.includes(mpPaymentId)) {
      processed.processedPayments.push(mpPaymentId)
    }

    if (!hot.externallyMarkedPayments.some(e => e.id === mpPaymentId)) {
      hot.externallyMarkedPayments.push({ id: mpPaymentId, markedAt: new Date().toISOString() })
    }

    appendActivity(logs, 'human', 'pago_marcado_recibido', {
      mpPaymentId,
      monto: payment?.monto,
    })
    audit({ category: 'user_action', action: 'mark_received.payment', result: 'success', actor: 'human', component: 'api/mark-payment-received', message: `Pago recibido: ${mpPaymentId}`, mpPaymentId, amount: payment?.monto })

    await Promise.all([saveHotState(hot), saveProcessed(processed), saveLogs(logs)])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
