import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import {
  getReclamosRecientes, marcarReclamoOk,
  getRegistroEntryById, confirmarAdjudicacion, rechazarAdjudicacion,
} from '@/lib/registro'
import { eliminarIngresoPorRegistro } from '@/lib/balance'
import { loadHotState, saveHotState, decrementPersistedMonthStats, acquireLock, releaseLock } from '@/lib/storage'
import { notifyTienda } from '@/lib/push'
import { nowART } from '@/lib/utils'

// GET /api/finanzas/reclamos → feed de pagos que las tiendas se adjudicaron
// (source='tienda_buscar'): firmes recientes (informativos) + adjudicaciones
// 'pendiente' (requieren confirmar/rechazar).
const VENTANA_MS = 7 * 24 * 60 * 60 * 1000
const LOCK_HOLDER = 'finanzas-reclamo'

export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const reclamos = await getReclamosRecientes(Date.now() - VENTANA_MS)
    return NextResponse.json({ reclamos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/finanzas/reclamos { id, action }
//   action='ok'        → saca un reclamo firme del feed (no toca nada). [default]
//   action='confirmar' → una adjudicación pendiente queda firme.
//   action='rechazar'  → revierte la adjudicación: borra el ingreso del saldo,
//                        resta el volumen del mes y el pago vuelve a la cola.
export async function POST(req: Request) {
  let locked = false
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const id = Number(body?.id)
    const action: string = body?.action || 'ok'
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id de reclamo requerido' }, { status: 400 })
    }

    // Dismiss informativo (comportamiento histórico).
    if (action === 'ok') {
      await marcarReclamoOk(id)
      return NextResponse.json({ success: true })
    }

    if (action === 'confirmar') {
      const ok = await confirmarAdjudicacion(id)
      if (!ok) return NextResponse.json({ error: 'Esa adjudicación ya no está pendiente' }, { status: 409 })
      const entry = await getRegistroEntryById(id)
      if (entry?.storeId) {
        try {
          const montoTxt = Number(entry.amount ?? entry.payment?.monto ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          await notifyTienda(entry.storeId, 'adjudicacion_resuelta', {
            title: 'Adjudicación confirmada',
            body: `Tu adjudicación de ${montoTxt} ARS (orden "${entry.orderNumber ?? ''}") quedó confirmada.`,
            url: '/tienda',
          })
        } catch { /* best-effort */ }
      }
      return NextResponse.json({ success: true, estado: 'confirmada' })
    }

    if (action === 'rechazar') {
      locked = await acquireLock(LOCK_HOLDER, `rechazo adjudicación ${id} por ${auth.user.email}`, 30_000)
      if (!locked) {
        return NextResponse.json({ error: 'El sistema está procesando otra operación. Esperá unos segundos.' }, { status: 409 })
      }

      const entry = await getRegistroEntryById(id)
      if (!entry || entry.adjudicacion !== 'pendiente') {
        return NextResponse.json({ error: 'Esa adjudicación ya no está pendiente' }, { status: 409 })
      }

      // CLAIM: marca 'rechazada' + action 'cancelled' solo si sigue pendiente.
      const claimed = await rechazarAdjudicacion(id)
      if (!claimed) return NextResponse.json({ error: 'Esa adjudicación ya no está pendiente' }, { status: 409 })

      // Revertir el saldo: borrar el movimiento de ingreso ligado a esta entrada.
      await eliminarIngresoPorRegistro(id)

      // Restar el volumen del mes y devolver el pago a la cola (queda disponible).
      const monto = Number(entry.amount ?? entry.payment?.monto ?? 0) || 0
      const hot = await loadHotState()
      decrementPersistedMonthStats(hot, monto, 'emparejamiento')
      if (entry.payment) {
        hot.unmatchedPayments.push({
          payment: entry.payment,
          timestamp: nowART(),
          mpPaymentId: entry.payment.mpPaymentId,
          storeName: entry.storeName,
        })
      }
      await saveHotState(hot)

      if (entry.storeId) {
        try {
          const montoTxt = monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          await notifyTienda(entry.storeId, 'adjudicacion_resuelta', {
            title: 'Adjudicación rechazada',
            body: `Tu adjudicación de ${montoTxt} ARS (orden "${entry.orderNumber ?? ''}") fue rechazada y se descontó de tu saldo.`,
            url: '/tienda',
          })
        } catch { /* best-effort */ }
      }
      return NextResponse.json({ success: true, estado: 'rechazada' })
    }

    return NextResponse.json({ error: 'action inválida' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    if (locked) await releaseLock(LOCK_HOLDER)
  }
}
