/**
 * /api/recovery — Endpoint de recuperación de pagos huérfanos.
 *
 * Permite remover un mpPaymentId de processedPayments para que el próximo ciclo
 * del cron lo re-detecte como nuevo y lo agregue a unmatchedPayments.
 *
 * Uso: POST /api/recovery  { "mpPaymentId": "...", "secret": "..." }
 *
 * ELIMINAR este endpoint una vez completada la recuperación.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadProcessed, saveProcessed } from '@/lib/storage'
import { requireUnidad } from '@/lib/auth/server'

export async function POST(req: NextRequest) {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const { mpPaymentId, secret } = await req.json()

    // Protección básica — usar la misma secret que el cron
    if (!secret || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    if (!mpPaymentId) {
      return NextResponse.json({ error: 'mpPaymentId requerido' }, { status: 400 })
    }

    const processed = await loadProcessed()
    const before = processed.processedPayments.length
    const wasThere = processed.processedPayments.includes(String(mpPaymentId))

    processed.processedPayments = processed.processedPayments.filter(
      id => id !== String(mpPaymentId)
    )

    await saveProcessed(processed)

    return NextResponse.json({
      success: true,
      mpPaymentId,
      wasThere,
      removedFrom: before,
      remaining: processed.processedPayments.length,
      message: wasThere
        ? `Pago ${mpPaymentId} removido de processedPayments. El próximo ciclo del cron lo re-agregará a unmatchedPayments.`
        : `Pago ${mpPaymentId} NO estaba en processedPayments.`,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
