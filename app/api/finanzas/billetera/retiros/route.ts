import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { walletsDeUnidad } from '@/lib/unidad'
import { validarDatosSolicitud } from '@/lib/transferencias'
import {
  registrarRetiro, getSalidasDeWallet, getDatosDeRetiros,
  TIPOS_SALIDA, TIPO_LABEL, monedaDeTipo,
} from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'
import type { TransferTipo } from '@/lib/types'

function walletValido(w: string): boolean {
  return !!w && walletsDeUnidad().includes(w)
}

// GET /api/finanzas/billetera/retiros?wallet=Lacar → retiros ya asentados
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim()
    if (!walletValido(wallet)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })

    const [salidas, datos] = await Promise.all([getSalidasDeWallet(wallet), getDatosDeRetiros(wallet)])
    return NextResponse.json({
      retiros: salidas.map(s => ({ ...s, datos: s.refTransferId ? datos[s.refTransferId] ?? {} : {} })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/finanzas/billetera/retiros
//   { wallet, tipo, datos, fecha, motivo?, cotizacion? }
//
// Asienta el retiro EN EL ACTO y descuenta el saldo. Una billetera gestiona sus
// propios retiros: no hay solicitud pendiente ni aprobación del admin (eso es el
// flujo de las tiendas).
//
// Los campos obligatorios de cada tipo los valida validarDatosSolicitud, la misma
// función que usa el portal de tiendas. Si el retiro es en USD o USDT, la cotización
// es obligatoria: calcularSalidaArs falla con un mensaje claro si no vino, en vez de
// descontar cero en silencio.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

    const wallet = String(body.wallet || '').trim()
    const tipo = body.tipo as TransferTipo
    if (!walletValido(wallet)) return NextResponse.json({ error: 'Billetera inválida' }, { status: 400 })
    if (!TIPOS_SALIDA.includes(tipo)) return NextResponse.json({ error: 'Tipo de retiro inválido' }, { status: 400 })

    const datos = validarDatosSolicitud(tipo, body.datos ?? {})
    const fecha = body.fecha ? new Date(String(body.fecha)).toISOString() : new Date().toISOString()
    if (Number.isNaN(new Date(fecha).getTime())) {
      return NextResponse.json({ error: 'Fecha del retiro inválida' }, { status: 400 })
    }

    const salida = await registrarRetiro({
      wallet, tipo, datos, fecha,
      motivo: String(body.motivo || '').trim() || TIPO_LABEL[tipo],
      cotizacion: body.cotizacion == null ? undefined : Number(body.cotizacion),
      createdBy: auth.user.email,
    })

    await audit({
      category: 'user_action', action: 'billetera.retiro', result: 'success',
      actor: 'human', component: 'billetera-salidas',
      message: `Retiro de ${wallet}: ${TIPO_LABEL[tipo]} · −$${salida.ars} (${monedaDeTipo(tipo)})`,
    })

    return NextResponse.json({ ok: true, salida })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
