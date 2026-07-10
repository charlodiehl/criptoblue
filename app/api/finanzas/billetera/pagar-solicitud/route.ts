import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { marcarSolicitudPagada, registrarSalida, listarSolicitudesBilletera } from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'

// POST /api/finanzas/billetera/pagar-solicitud  { wallet, id }
//
// Confirma el pago: marca la solicitud pagada y registra la salida, que baja el
// saldo de la billetera. marcarSolicitudPagada es un CLAIM condicional (solo si
// sigue pendiente): si dos admins confirman a la vez, uno recibe 409 y la salida
// se registra una sola vez.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const wallet = String(body?.wallet || '').trim()
    const id = Number(body?.id)
    if (!wallet || !Number.isFinite(id)) return NextResponse.json({ error: 'wallet e id son requeridos' }, { status: 400 })

    const solicitud = (await listarSolicitudesBilletera(wallet)).find(s => s.id === id)
    if (!solicitud) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
    if (solicitud.estado !== 'pendiente') return NextResponse.json({ error: 'La solicitud ya fue pagada' }, { status: 409 })

    const claimed = await marcarSolicitudPagada(id, auth.user.email)
    if (!claimed) return NextResponse.json({ error: 'Otro admin acaba de pagarla' }, { status: 409 })

    const d = solicitud.datos ?? {}
    const esBillete = solicitud.tipo === 'usd_billete'
    const salida = await registrarSalida({
      wallet,
      tipo: esBillete ? 'usd_billete' : 'transferencia_ars',
      fecha: d.fecha ? new Date(String(d.fecha)).toISOString() : new Date().toISOString(),
      ars: Number(d.ars),
      usd: esBillete ? Number(d.usd) : null,
      usdRate: esBillete ? Number(d.cotizacion) : null,
      motivo: String(d.motivo || (esBillete ? 'Retiro usd billete' : 'Transferencia ARS')),
      refTransferId: id,
      createdBy: auth.user.email,
    })

    await audit({
      category: 'user_action', action: 'billetera.solicitud.pagar', result: 'success',
      actor: 'human', component: 'billetera-salidas',
      message: `Solicitud #${id} de ${wallet} pagada: −$${salida.ars}`,
    })

    return NextResponse.json({ ok: true, salida })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
