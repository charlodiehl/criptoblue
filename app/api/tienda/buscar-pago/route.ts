import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { loadHotState } from '@/lib/storage'
import { nameSimilarity } from '@/lib/auto-match'
import { billeteraLabel } from '@/lib/utils'
import { buscarEmparejadosPorMonto } from '@/lib/registro'

// POST /api/tienda/buscar-pago — { nombre, monto, fechaHora }
//
// Busca EN LOS PAGOS DE LA APP (no en MercadoPago) los que cumplan los 3 criterios:
//  - Monto: igualdad EXACTA
//  - Nombre: coincidencia parcial (nameSimilarity >= 70, mismo criterio que la
//    señal verde de Nombre del emparejamiento)
//  - Fecha/hora: diferencia máxima de 24 horas
//
// Busca en DOS lados y marca el estado de cada resultado:
//  - 'disponible' → pago en cola sin emparejar: se puede reclamar.
//  - 'usado'      → pago YA emparejado con una orden: se muestra bloqueado, para
//                   impedir que un mismo pago valide más de una orden. Por privacidad
//                   entre tiendas, solo se revela el número de orden si el pago se usó
//                   en una orden de ESTA MISMA tienda (ordenPropia).
//
// fechaHora llega del <input datetime-local> ("YYYY-MM-DDTHH:mm", sin zona) y se
// interpreta como hora Argentina (-03:00).
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

    // Tienda del que busca: rol tienda usa la suya; admin (espejo) la del request.
    // Solo se usa para decidir si se revela el número de orden de un pago ya usado.
    const storeIdScope = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body.storeId)

    const VENTANA_MS = 24 * 60 * 60 * 1000
    const coincideFechaNombre = (fechaPago: string, nombrePagador: string) => {
      if (nameSimilarity(nombre, nombrePagador || '') < 70) return false
      const t = fechaPago ? new Date(fechaPago).getTime() : NaN
      if (Number.isNaN(t)) return false
      return Math.abs(t - target) <= VENTANA_MS
    }

    const hot = await loadHotState()

    interface PagoEncontrado {
      mpPaymentId: string
      monto: number
      nombrePagador: string
      fechaPago: string
      billetera: string
      estado: 'disponible' | 'usado'
      ordenPropia?: string   // solo si el pago ya se usó en una orden de ESTA tienda
    }

    // 1) Pagos YA USADOS (emparejados en el registro) — se muestran bloqueados.
    const emparejados = await buscarEmparejadosPorMonto(montoNum)
    const usados: PagoEncontrado[] = []
    const idsUsados = new Set<string>()
    for (const e of emparejados) {
      if (e.monto !== montoNum) continue
      if (!coincideFechaNombre(e.fechaPago, e.nombrePagador)) continue
      if (e.mpPaymentId) idsUsados.add(e.mpPaymentId)
      usados.push({
        mpPaymentId: e.mpPaymentId || `usado-${usados.length}`,
        monto: e.monto,
        nombrePagador: e.nombrePagador,
        fechaPago: e.fechaPago,
        billetera: billeteraLabel(e.source),
        estado: 'usado',
        ordenPropia: storeIdScope && e.storeId === storeIdScope ? e.orderNumber : undefined,
      })
    }

    // 2) Pagos DISPONIBLES (en cola, sin emparejar). Se excluyen los que ya aparecen
    //    como usados (por si un pago quedó en la cola por inconsistencia).
    const disponibles: PagoEncontrado[] = (hot.unmatchedPayments ?? [])
      .map(u => u.payment)
      .filter(p => {
        if (!p) return false
        if (p.monto !== montoNum) return false
        if (p.mpPaymentId && idsUsados.has(p.mpPaymentId)) return false
        return coincideFechaNombre(p.fechaPago || '', p.nombrePagador || '')
      })
      .map(p => ({
        mpPaymentId: p.mpPaymentId,
        monto: p.monto,
        nombrePagador: p.nombrePagador,
        fechaPago: p.fechaPago,
        billetera: billeteraLabel(p.source),
        estado: 'disponible' as const,
      }))

    // Disponibles primero (accionables), luego los usados (bloqueados).
    const pagos = [...disponibles, ...usados]
    return NextResponse.json({ found: pagos.length > 0, pagos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
