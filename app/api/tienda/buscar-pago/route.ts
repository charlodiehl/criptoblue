import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { loadHotState } from '@/lib/storage'
import { nameSimilarity } from '@/lib/auto-match'
import { billeteraLabel } from '@/lib/utils'

// POST /api/tienda/buscar-pago — { nombre, monto, fechaHora }
//
// Busca en los pagos pendientes de emparejar (cola global, TODAS las billeteras —
// decisión del usuario) los que cumplan LOS 3 criterios a la vez:
//  - Monto: igualdad EXACTA
//  - Nombre: coincidencia parcial (nameSimilarity >= 70, mismo criterio que la
//    señal verde de Nombre del emparejamiento)
//  - Fecha/hora: diferencia máxima de 24 horas
//
// fechaHora llega del <input datetime-local> del portal ("YYYY-MM-DDTHH:mm",
// sin zona) y se interpreta como hora Argentina (-03:00).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const { nombre, monto, fechaHora } = body

    if (typeof nombre !== 'string' || nombre.trim().length < 3) {
      return NextResponse.json({ error: 'Ingresá el nombre y apellido del pagador' }, { status: 400 })
    }
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }
    if (typeof fechaHora !== 'string' || !fechaHora) {
      return NextResponse.json({ error: 'Ingresá la fecha y hora del pago' }, { status: 400 })
    }
    // Sin zona horaria explícita → hora Argentina
    const conZona = /[zZ]|[+-]\d{2}:\d{2}$/.test(fechaHora) ? fechaHora : `${fechaHora}:00-03:00`.replace(/:00:00-03:00$/, ':00-03:00')
    const target = new Date(conZona).getTime()
    if (Number.isNaN(target)) {
      return NextResponse.json({ error: 'Fecha y hora inválidas' }, { status: 400 })
    }

    const VENTANA_MS = 24 * 60 * 60 * 1000
    const hot = await loadHotState()

    const pagos = (hot.unmatchedPayments ?? [])
      .map(u => u.payment)
      .filter(p => {
        if (!p) return false
        if (p.monto !== montoNum) return false
        if (nameSimilarity(nombre, p.nombrePagador || '') < 70) return false
        const t = p.fechaPago ? new Date(p.fechaPago).getTime() : NaN
        if (Number.isNaN(t)) return false
        return Math.abs(t - target) <= VENTANA_MS
      })
      .map(p => ({
        mpPaymentId: p.mpPaymentId,
        monto: p.monto,
        nombrePagador: p.nombrePagador,
        fechaPago: p.fechaPago,
        billetera: billeteraLabel(p.source),
      }))

    return NextResponse.json({ found: pagos.length > 0, pagos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
