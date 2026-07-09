import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { WALLETS } from '@/lib/config'
import { agregarSaldoPersonalizado } from '@/lib/saldo-personalizado'

// POST /api/finanzas/saldo-personalizado
//   { tipo:'tienda'|'billetera', id, fechaHora, monto, tasa?, cuit?, nombre?, motivo? }
//
// Registra un ingreso manual a una tienda (con tasa → USDT) o billetera (ARS) y lo
// suma al balance. La fecha/hora es la del pago (columna "Fecha y hora"). Admin-only.

// datetime-local ("YYYY-MM-DDTHH:mm", hora Argentina) → instante ISO. Acepta ISO completo.
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

    const body = await req.json().catch(() => null)
    const tipo = body?.tipo
    const id = String(body?.id || '').trim()
    const monto = Number(body?.monto)
    if (tipo !== 'tienda' && tipo !== 'billetera') return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
    if (!id) return NextResponse.json({ error: 'Elegí una tienda o billetera' }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto a agregar inválido' }, { status: 400 })

    const fechaHoraISO = toInstanteISO(String(body?.fechaHora || ''))
    if (!fechaHoraISO) return NextResponse.json({ error: 'Fecha y hora inválida' }, { status: 400 })

    let storeName: string | undefined
    let tasa: number | undefined
    if (tipo === 'tienda') {
      const stores = await getStores()
      const store = stores[id]
      if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
      storeName = store.storeName
      tasa = Number(body?.tasa)
      if (!Number.isFinite(tasa) || tasa <= 0) return NextResponse.json({ error: 'La tasa ARS/USDT es obligatoria para tiendas' }, { status: 400 })
    } else {
      if (!(WALLETS as readonly string[]).includes(id)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
    }

    await agregarSaldoPersonalizado({
      tipo, id, storeName, fechaHoraISO, monto, tasa,
      cuit: body?.cuit ? String(body.cuit).trim() : undefined,
      nombre: body?.nombre ? String(body.nombre).trim() : undefined,
      motivo: body?.motivo ? String(body.motivo).trim() : undefined,
      createdBy: auth.user.email,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
