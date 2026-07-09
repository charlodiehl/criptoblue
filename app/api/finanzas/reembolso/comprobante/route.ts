import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { subirComprobanteReembolso } from '@/lib/reembolsos'

// POST /api/finanzas/reembolso/comprobante  (multipart: file)
// Sube el comprobante del reembolso al bucket privado y devuelve su path. El path
// se manda después a /api/finanzas/reembolso al ejecutar. Admin-only.
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo supera los 10 MB' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const path = await subirComprobanteReembolso(file.name || 'comprobante', bytes, file.type || 'application/octet-stream')

    return NextResponse.json({ success: true, path })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
