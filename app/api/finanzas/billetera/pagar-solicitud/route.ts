import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import {
  marcarSolicitudPagada, registrarSalida, listarSolicitudesBilletera,
  calcularSalidaArs, monedaDeTipo, TIPO_LABEL,
} from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'
import type { TransferTipo } from '@/lib/types'

// POST /api/finanzas/billetera/pagar-solicitud  { wallet, id, cotizacion? }
//
// Confirma el pago: marca la solicitud pagada y registra la salida, que baja el
// saldo. Si el retiro es en USD o USDT hace falta la cotización (ARS por 1 unidad):
// calcularSalidaArs la exige y falla con un mensaje claro si no vino.
//
// marcarSolicitudPagada es un CLAIM condicional (solo si sigue pendiente): si dos
// admins confirman a la vez, uno recibe 409 y la salida se registra una sola vez.
// El orden importa: primero se calcula el ARS (puede fallar por falta de cotización),
// recién después se marca pagada. Así una solicitud no queda pagada sin su egreso.
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

    const tipo = solicitud.tipo as TransferTipo
    const datos = solicitud.datos ?? {}
    const calc = calcularSalidaArs(tipo, datos, body?.cotizacion)

    const claimed = await marcarSolicitudPagada(id, auth.user.email)
    if (!claimed) return NextResponse.json({ error: 'Otro admin acaba de pagarla' }, { status: 409 })

    const salida = await registrarSalida({
      wallet, tipo,
      fecha: datos.fecha ? new Date(String(datos.fecha)).toISOString() : new Date().toISOString(),
      ars: calc.ars, moneda: calc.moneda, montoOrigen: calc.montoOrigen, cotizacion: calc.cotizacion,
      motivo: String(datos.motivo || TIPO_LABEL[tipo]),
      refTransferId: id, createdBy: auth.user.email,
    })

    await audit({
      category: 'user_action', action: 'billetera.solicitud.pagar', result: 'success',
      actor: 'human', component: 'billetera-salidas',
      message: `Solicitud #${id} de ${wallet} pagada: −$${salida.ars} (${monedaDeTipo(tipo)})`,
    })

    return NextResponse.json({ ok: true, salida })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
