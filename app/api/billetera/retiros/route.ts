import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { validarDatosSolicitud } from '@/lib/transferencias'
import {
  registrarRetiro, getSalidasDeWallet, getDatosDeRetiros,
  TIPOS_SALIDA, TIPO_LABEL, monedaDeTipo,
} from '@/lib/billetera-salidas'
import { audit } from '@/lib/audit'
import type { TransferTipo } from '@/lib/types'

// GET /api/billetera/retiros → retiros ya asentados de la billetera del usuario.
// Rol 'billetera' (editor o lectura). Fuerza su propia billetera.
export async function GET() {
  try {
    const auth = await requireUser('billetera')
    if ('error' in auth) return auth.error
    const wallet = auth.user.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    const [salidas, datos] = await Promise.all([getSalidasDeWallet(wallet), getDatosDeRetiros(wallet)])
    return NextResponse.json({
      retiros: salidas.map(s => ({ ...s, datos: s.refTransferId ? datos[s.refTransferId] ?? {} : {} })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/billetera/retiros  { tipo, datos, fecha, motivo?, cotizacion? }
// Asienta un retiro de la billetera del usuario. SOLO permiso 'editor'.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('billetera')
    if ('error' in auth) return auth.error
    if (auth.user.billeteraPermiso !== 'editor') {
      return NextResponse.json({ error: 'Tu permiso es de solo lectura: no podés registrar retiros' }, { status: 403 })
    }
    const wallet = auth.user.wallet
    if (!wallet) return NextResponse.json({ error: 'No hay billetera asignada' }, { status: 400 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

    const tipo = body.tipo as TransferTipo
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
      message: `Retiro de ${wallet} (dueño): ${TIPO_LABEL[tipo]} · −$${salida.ars} (${monedaDeTipo(tipo)})`,
    })

    return NextResponse.json({ ok: true, salida })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
