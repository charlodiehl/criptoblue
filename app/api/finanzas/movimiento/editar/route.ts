import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { editarMovimiento } from '@/lib/editar-movimiento'

// POST /api/finanzas/movimiento/editar
//   { fuente:'balance'|'wallet'|'refund', id, fecha?, concepto?, montoArs?, tasa? }
//
// Edita un movimiento del extracto (tienda o billetera) y sincroniza las tablas
// ligadas para que no se descuadren los saldos. Admin-only.

// datetime-local ("YYYY-MM-DDTHH:mm", hora Argentina) → instante ISO. Acepta ISO.
function toInstanteISO(v: string): string | null {
  const s = (v || '').trim()
  if (!s) return null
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.length === 16 ? `${s}:00` : s}-03:00` : s
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const fuente = body?.fuente
    const id = Number(body?.id)
    if (fuente !== 'balance' && fuente !== 'wallet' && fuente !== 'refund') {
      return NextResponse.json({ error: 'fuente inválida' }, { status: 400 })
    }
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    let fecha: string | undefined
    if (body?.fecha !== undefined && body?.fecha !== null && String(body.fecha).trim() !== '') {
      const iso = toInstanteISO(String(body.fecha))
      if (!iso) return NextResponse.json({ error: 'Fecha y hora inválida' }, { status: 400 })
      fecha = iso
    }

    const montoArs = body?.montoArs === undefined || body?.montoArs === null || body?.montoArs === ''
      ? undefined : Number(body.montoArs)
    const tasa = body?.tasa === undefined || body?.tasa === null || body?.tasa === ''
      ? undefined : Number(body.tasa)
    if (montoArs !== undefined && (!Number.isFinite(montoArs) || montoArs <= 0)) {
      return NextResponse.json({ error: 'El monto debe ser un número mayor a 0' }, { status: 400 })
    }
    if (tasa !== undefined && (!Number.isFinite(tasa) || tasa <= 0)) {
      return NextResponse.json({ error: 'La tasa debe ser un número mayor a 0' }, { status: 400 })
    }

    const { avisoTransferencia } = await editarMovimiento({
      fuente, id, fecha,
      concepto: body?.concepto !== undefined ? String(body.concepto) : undefined,
      montoArs, tasa,
      nombre: body?.nombre !== undefined ? String(body.nombre).trim() : undefined,
      cuit: body?.cuit !== undefined ? String(body.cuit).trim() : undefined,
      orderNumber: body?.orderNumber !== undefined ? String(body.orderNumber).trim() : undefined,
    })

    return NextResponse.json({
      success: true,
      aviso: avisoTransferencia
        ? 'Se guardaron fecha y concepto. El monto/tasa de una transferencia no se edita desde acá (tiene su propia moneda).'
        : undefined,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
