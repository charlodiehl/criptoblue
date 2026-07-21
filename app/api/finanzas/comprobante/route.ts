import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getSolicitudById, subirComprobante } from '@/lib/transferencias'

// POST /api/finanzas/comprobante  (multipart: file, id)
// Sube el comprobante de una solicitud al bucket privado y devuelve su path.
// El path se manda después a /api/finanzas/pagar-solicitud al confirmar el pago.
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const form = await req.formData()
    // El id llega por FormData (flujo viejo) o por query (?id=, que usa ComprobanteInput).
    const idStr = String(form.get('id') ?? req.nextUrl.searchParams.get('id') ?? '')
    const id = Number(idStr)
    const file = form.get('file')
    if (!idStr || !Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo supera los 10 MB' }, { status: 400 })

    const solicitud = await getSolicitudById(id)
    if (!solicitud) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })

    const bytes = await file.arrayBuffer()
    const path = await subirComprobante(id, file.name, bytes, file.type || 'application/octet-stream')

    return NextResponse.json({ success: true, path })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
