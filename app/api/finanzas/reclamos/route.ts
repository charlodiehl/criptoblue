import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getReclamosRecientes } from '@/lib/registro'

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
