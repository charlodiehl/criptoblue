import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getReclamosRecientes, marcarReclamoOk } from '@/lib/registro'

// GET /api/finanzas/reclamos → feed informativo de los últimos 7 días de pagos
// que las tiendas se adjudicaron desde "Buscar pagos" (source='tienda_buscar').
const VENTANA_MS = 7 * 24 * 60 * 60 * 1000

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

// POST /api/finanzas/reclamos → el admin da OK a un reclamo (lo saca del feed).
// Solo marca el id como visto; no toca el pago, el registro ni el balance.
export async function POST(req: Request) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const id = Number(body?.id)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id de reclamo requerido' }, { status: 400 })
    }
    await marcarReclamoOk(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
