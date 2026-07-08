import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getIngresosBilleteras } from '@/lib/billeteras'

// GET /api/finanzas/billeteras → un ítem por billetera con ingresos: { wallet, totalArs, cantidad }
// Solo las billeteras con al menos un pago ingresado y no ocultas. Admin-only.
export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const billeteras = await getIngresosBilleteras()
    return NextResponse.json({ billeteras })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
