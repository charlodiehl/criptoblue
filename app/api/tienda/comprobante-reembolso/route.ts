import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { getRefundById, urlComprobanteReembolso } from '@/lib/reembolsos'

// GET /api/tienda/comprobante-reembolso?id={refundId}[&storeId=]
// Redirige a la URL firmada del comprobante de un reembolso, verificando que el
// reembolso sea de la tienda del usuario (rol tienda) o de la tienda pedida (admin).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const id = Number(req.nextUrl.searchParams.get('id'))
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const refund = await getRefundById(id)
    if (!refund || !refund.comprobantePath) {
      return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    }

    // Scope: el reembolso debe pertenecer a la tienda del scope resuelto. A un no-admin
    // se le responde 404 (no 403) para no revelar que ese id existe en otra tienda. Se
    // chequea !== 'admin' (no === 'tienda') para cubrir multi-acceso: un usuario billetera-
    // primario con acceso extra a una tienda igual queda scopeado por resolveStoreScope.
    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (auth.user.role !== 'admin' && refund.storeId !== storeId) {
      return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    }

    const url = await urlComprobanteReembolso(refund.comprobantePath)
    if (!url) return NextResponse.json({ error: 'No se pudo generar el enlace' }, { status: 500 })
    return NextResponse.redirect(url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
