import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { crearSolicitud, listarSolicitudesTienda, validarDatosSolicitud } from '@/lib/transferencias'
import { getStores } from '@/lib/storage'
import { notifyAdmins } from '@/lib/push'
import type { TransferTipo } from '@/lib/types'

const TIPOS: TransferTipo[] = ['ars', 'usd', 'usdt', 'usd_billete', 'ars_billete']
const MONEDA: Record<TransferTipo, string> = { ars: 'ARS', usd: 'USD', usdt: 'USDT', usd_billete: 'USD billete', ars_billete: 'ARS billete' }

// GET /api/tienda/transferencias[?storeId=]  → solicitudes de la tienda
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const solicitudes = await listarSolicitudesTienda(storeId)
    return NextResponse.json({ solicitudes })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST /api/tienda/transferencias  { tipo, datos, storeId? }  → crea la solicitud
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    // La vista espejo del admin manda el storeId en el query (?storeId=), igual que el
    // GET; se acepta también en el body por compatibilidad. Antes solo se leía el body,
    // así que al admin le fallaba el envío con "No hay tienda asignada".
    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId') || body.storeId)
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const tipo = body.tipo as TransferTipo
    if (!TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo de transferencia inválido' }, { status: 400 })
    }

    let datos: Record<string, string | number>
    try {
      datos = validarDatosSolicitud(tipo, body.datos ?? {})
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Datos inválidos' }, { status: 400 })
    }

    const solicitud = await crearSolicitud(storeId, tipo, datos, auth.user.email)

    // Notificar a los administradores (best-effort: no debe frenar la respuesta).
    try {
      const stores = await getStores()
      const storeName = stores[storeId]?.storeName || 'Una tienda'
      const monto = Number(datos.montoArs ?? datos.montoUsd ?? datos.montoUsdt ?? datos.monto ?? 0)
      const montoTxt = monto ? monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
      await notifyAdmins('transferencia_solicitada', {
        title: 'Transferencia solicitada',
        body: `${storeName} solicitó una transferencia${montoTxt ? ` de ${montoTxt} ${MONEDA[tipo]}` : ''} para pagar.`,
        url: '/finanzas',
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true, solicitud })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
