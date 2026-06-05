import { NextRequest, NextResponse } from 'next/server'
import { fetchApprovedPaymentsBetween } from '@/lib/mercadopago'
import { isPaymentAlreadyUsed } from '@/lib/registro'
import { loadHotState } from '@/lib/storage'
import type { Payment } from '@/lib/types'

// Tolerancia de monto: prácticamente exacto (absorbe centavos por floats).
const MONTO_TOL = 0.01
// Diferencia de tiempo máxima permitida entre el comprobante y el pago en MP.
const MAX_DIFF_MS = 60 * 1000 // 1 minuto
// Ventana de fetch a MP: algo más amplia que el criterio, para no perder el
// pago por bordes. Luego se filtra estricto a ≤1 min.
const FETCH_MARGEN_MS = 5 * 60 * 1000 // ±5 minutos

// POST { monto: number, fechaISO: string }
// Busca en MercadoPago pagos aprobados con monto exacto y fecha/hora dentro de
// ±1 minuto del comprobante. Marca cuáles ya están en la cola o ya fueron emparejados.
export async function POST(req: NextRequest) {
  try {
    const { monto, fechaISO } = await req.json()

    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }
    const fechaMs = fechaISO ? new Date(fechaISO).getTime() : NaN
    if (!Number.isFinite(fechaMs)) {
      return NextResponse.json({ error: 'Fecha/hora inválida' }, { status: 400 })
    }

    // Ventana de búsqueda en MP
    const begin = new Date(fechaMs - FETCH_MARGEN_MS)
    const end = new Date(Math.min(fechaMs + FETCH_MARGEN_MS, Date.now() + 60 * 1000))

    const pagos = await fetchApprovedPaymentsBetween(begin, end)

    // Filtrar: monto exacto + diferencia de fecha ≤ 1 min
    const coincidencias = pagos.filter(p => {
      if (Math.abs(p.monto - montoNum) > MONTO_TOL) return false
      const pMs = p.fechaPago ? new Date(p.fechaPago).getTime() : NaN
      if (!Number.isFinite(pMs)) return false
      return Math.abs(pMs - fechaMs) <= MAX_DIFF_MS
    })

    // Estado de cada coincidencia: ¿ya en cola? ¿ya emparejado en el registro?
    const hot = await loadHotState()
    const enColaIds = new Set(
      (hot.unmatchedPayments ?? []).map(u => u.payment?.mpPaymentId || u.mpPaymentId).filter(Boolean)
    )

    const resultados = await Promise.all(
      coincidencias.map(async (payment: Payment) => ({
        payment,
        enCola: enColaIds.has(payment.mpPaymentId),
        yaEmparejado: await isPaymentAlreadyUsed(payment.mpPaymentId),
      }))
    )

    return NextResponse.json({ resultados, total: resultados.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
