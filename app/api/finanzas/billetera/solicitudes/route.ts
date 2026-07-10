import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { WALLETS } from '@/lib/config'
import {
  crearSolicitudBilletera, listarSolicitudesBilletera, calcularSalidaArs, type SalidaTipo,
} from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'

const TIPOS: SalidaTipo[] = ['transferencia_ars', 'usd_billete']

function walletValido(w: string): boolean {
  return !!w && (WALLETS as readonly string[]).includes(w)
}

// GET /api/finanzas/billetera/solicitudes?wallet=Lacar → solicitudes de esa billetera
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

// POST /api/finanzas/billetera/solicitudes
//   { wallet, tipo: 'transferencia_ars'|'usd_billete', montoArs?, montoUsd?, cotizacion?, motivo?, fecha? }
//
// Crea la solicitud en estado pendiente. No mueve el saldo: eso ocurre recién al
// pagarla (POST pagar-solicitud), igual que en el flujo de las tiendas.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

    const wallet = String(body.wallet || '').trim()
    const tipo = body.tipo as SalidaTipo
    if (!walletValido(wallet)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
    if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo de salida inválido' }, { status: 400 })

    // calcularSalidaArs valida los montos y lanza con un mensaje claro.
    const { ars, usd, usdRate } = calcularSalidaArs(tipo, {
      montoArs: Number(body.montoArs),
      montoUsd: Number(body.montoUsd),
      cotizacion: Number(body.cotizacion),
    })

    const datos: Record<string, string | number> = {
      ars, motivo: String(body.motivo || '').trim() || (tipo === 'usd_billete' ? 'Retiro usd billete' : 'Transferencia ARS'),
    }
    if (usd != null) { datos.usd = usd; datos.cotizacion = usdRate as number }
    if (body.fecha) datos.fecha = String(body.fecha)

    const id = await crearSolicitudBilletera(wallet, tipo, datos, auth.user.email)

    await audit({
      category: 'user_action', action: 'billetera.solicitud.crear', result: 'success',
      actor: 'human', component: 'billetera-salidas',
      message: `Solicitud #${id} de ${wallet}: ${tipo} por $${ars}`,
    })

    return NextResponse.json({ id, ars })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
