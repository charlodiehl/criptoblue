import { NextRequest, NextResponse } from 'next/server'
import { loadHotState, saveHotState, loadLogs, saveLogs, appendActivity, acquireLock, releaseLock } from '@/lib/storage'

const LOCK_HOLDER = 'dismiss'

export async function POST(req: NextRequest) {
  try {
    const locked = await acquireLock(LOCK_HOLDER)
    if (!locked) {
      return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
    }

    const { mpPaymentId, orderId, storeId } = await req.json()
    if (!mpPaymentId || !orderId || !storeId) {
      return NextResponse.json({ error: 'mpPaymentId, orderId y storeId son requeridos' }, { status: 400 })
    }

    const [hot, logs] = await Promise.all([loadHotState(), loadLogs()])

    const yaExiste = (hot.dismissedPairs ?? []).some(
      p => p.mpPaymentId === mpPaymentId && p.orderId === orderId && p.storeId === storeId
    )
    if (!yaExiste) {
      hot.dismissedPairs = hot.dismissedPairs ?? []
      hot.dismissedPairs.push({ mpPaymentId, orderId, storeId, dismissedAt: new Date().toISOString() })
    }

    appendActivity(logs, 'human', 'par_descartado', { mpPaymentId, orderId, storeId })

    await Promise.all([saveHotState(hot), saveLogs(logs)])

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await releaseLock(LOCK_HOLDER)
  }
}
