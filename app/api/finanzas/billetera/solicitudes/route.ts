import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { WALLETS } from '@/lib/config'
import { validarDatosSolicitud } from '@/lib/transferencias'
import { crearSolicitudBilletera, listarSolicitudesBilletera, TIPOS_SALIDA, TIPO_LABEL } from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'
import type { TransferTipo } from '@/lib/types'

function walletValido(w: string): boolean {
  return !!w && (WALLETS as readonly string[]).includes(w)
}

// GET /api/finanzas/billetera/solicitudes?wallet=Lacar
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim()
    if (!walletValido(wallet)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })

    return NextResponse.json({ solicitudes: await listarSolicitudesBilletera(wallet) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/finanzas/billetera/solicitudes  { wallet, tipo, datos, fecha? }
//
// Los mismos 5 tipos y los mismos campos obligatorios que las tiendas:
// validarDatosSolicitud es la fuente de verdad y lanza con un mensaje claro.
// No mueve el saldo: eso ocurre al pagarla, donde se pide la cotización si hace falta.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

    const wallet = String(body.wallet || '').trim()
    const tipo = body.tipo as TransferTipo
    if (!walletValido(wallet)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
    if (!TIPOS_SALIDA.includes(tipo)) return NextResponse.json({ error: 'Tipo de retiro inválido' }, { status: 400 })

    const datos = validarDatosSolicitud(tipo, body.datos ?? {})
    if (body.motivo) datos.motivo = String(body.motivo).trim()
    if (body.fecha) datos.fecha = String(body.fecha)

    const id = await crearSolicitudBilletera(wallet, tipo, datos, auth.user.email)

    await audit({
      category: 'user_action', action: 'billetera.solicitud.crear', result: 'success',
      actor: 'human', component: 'billetera-salidas',
      message: `Solicitud #${id} de ${wallet}: ${TIPO_LABEL[tipo]}`,
    })

    return NextResponse.json({ id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
