import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getMetricas } from '@/lib/metricas'

// GET /api/finanzas/metricas?desde=<ISO>&hasta=<ISO> — métricas del período (solo admin).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const desde = new Date(req.nextUrl.searchParams.get('desde') ?? '').getTime()
    const hasta = new Date(req.nextUrl.searchParams.get('hasta') ?? '').getTime()
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) {
      return NextResponse.json({ error: 'Rango de fechas inválido (desde/hasta)' }, { status: 400 })
    }
    // Tope de seguridad: no permitir rangos absurdos (> 400 días).
    if (hasta - desde > 400 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'El rango no puede superar los 400 días' }, { status: 400 })
    }

    const metricas = await getMetricas(desde, hasta)
    return NextResponse.json(metricas)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
