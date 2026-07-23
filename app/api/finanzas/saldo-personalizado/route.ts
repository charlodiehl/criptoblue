import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { walletsDeUnidad } from '@/lib/unidad'
import { agregarSaldoPersonalizado } from '@/lib/saldo-personalizado'

// POST /api/finanzas/saldo-personalizado
//   { storeId, fechaHora, monto, tasa, billetera, billeteraOtra?, cuit?, nombre?, motivo? }
//
// Registra un ingreso manual (saldo personalizado) a una TIENDA: se suma al saldo en
// USDT (monto ÷ tasa) con su comisión, se atribuye a la billetera de origen elegida y
// figura en la sección de movimientos con la fecha del pago. Admin-only.

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
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const storeId = String(body?.storeId || '').trim()
    const monto = Number(body?.monto)
    const tasa = Number(body?.tasa)
    if (!storeId) return NextResponse.json({ error: 'Elegí una tienda' }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto a agregar inválido' }, { status: 400 })
    if (!Number.isFinite(tasa) || tasa <= 0) return NextResponse.json({ error: 'La tasa ARS/USDT es obligatoria' }, { status: 400 })

    const fechaHoraISO = toInstanteISO(String(body?.fechaHora || ''))
    if (!fechaHoraISO) return NextResponse.json({ error: 'Fecha y hora inválida' }, { status: 400 })

    const store = (await getStores())[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // Billetera de origen: una de las billeteras, o "Otras" con nombre libre.
    const billeteraSel = String(body?.billetera || '').trim()
    const nombreOtras = String(body?.billeteraOtra || '').trim()
    if (billeteraSel !== 'Otras' && !walletsDeUnidad().includes(billeteraSel)) {
      return NextResponse.json({ error: 'Elegí desde qué billetera entró el pago' }, { status: 400 })
    }
    if (billeteraSel === 'Otras' && !nombreOtras) {
      return NextResponse.json({ error: 'Completá el nombre de la billetera (Otras)' }, { status: 400 })
    }
    const billeteraSource = billeteraSel === 'Otras' ? `otras:${nombreOtras}` : billeteraSel

    await agregarSaldoPersonalizado({
      storeId, storeName: store.storeName, fechaHoraISO, monto, tasa, billeteraSource,
      cuit: body?.cuit ? String(body.cuit).trim() : undefined,
      nombre: body?.nombre ? String(body.nombre).trim() : undefined,
      motivo: body?.motivo ? String(body.motivo).trim() : undefined,
      sinComision: body?.sinComision === true,
      createdBy: auth.user.email,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
