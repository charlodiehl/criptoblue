import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { buscarEntradasPorOrden, updateRegistroPorId } from '@/lib/registro'
import { actualizarCotizacionDeIngreso } from '@/lib/balance'
import { audit } from '@/lib/audit'

// POST /api/finanzas/registro/editar
//   { registroId, storeId, cotizacion?, cuit?, nombre?, orderNumber? }
//
// Los cuatro campos que el admin puede corregir de una orden ya registrada. No se
// tocan monto ni fecha: eso movería el saldo por la puerta de atrás.
//
// La ÚNICA condición que bloquea es que el número de orden sea exactamente igual al
// de otra entrada de esa tienda (409). Que la orden no exista, o esté pendiente o
// cancelada, o que haya un pago parcial con otro sufijo, son avisos que el admin ya
// vio al validar: acá no se repiten como errores.
//
// El saldo solo cambia si cambia la cotización: se recalcula el USDT del ingreso
// (el ARS queda igual). Eso pasa DESPUÉS de guardar los campos, y si falla se
// informa: los campos ya quedaron guardados y el saldo no cambió.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

    const registroId = Number(body.registroId)
    const storeId = String(body.storeId || '').trim()
    if (!Number.isFinite(registroId) || !storeId) {
      return NextResponse.json({ error: 'registroId y storeId son requeridos' }, { status: 400 })
    }

    const orderNumber = body.orderNumber === undefined ? undefined : String(body.orderNumber).trim()
    const nombre = body.nombre === undefined ? undefined : String(body.nombre).trim()
    const cuit = body.cuit === undefined ? undefined : String(body.cuit).trim()
    const cotizacion = body.cotizacion === undefined || body.cotizacion === null || body.cotizacion === ''
      ? undefined
      : Number(body.cotizacion)

    if (cotizacion !== undefined && (!Number.isFinite(cotizacion) || cotizacion <= 0)) {
      return NextResponse.json({ error: 'La cotización debe ser un número mayor a 0' }, { status: 400 })
    }
    if (orderNumber !== undefined && !orderNumber) {
      return NextResponse.json({ error: 'El número de orden no puede quedar vacío' }, { status: 400 })
    }

    // Lo único que bloquea. Un sufijo distinto ("77349" vs "77349 (1)") NO es un
    // duplicado: es un pago que vino en dos partes.
    if (orderNumber !== undefined) {
      const store = (await getStores())[storeId]
      if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
      const { exactas } = await buscarEntradasPorOrden(storeId, store.storeName, orderNumber, registroId)
      if (exactas.length) {
        return NextResponse.json({
          error: `La orden #${orderNumber} ya está en otra entrada del registro de esta tienda.`,
          duplicadoExacto: exactas[0],
        }, { status: 409 })
      }
    }

    const ok = await updateRegistroPorId(registroId, { orderNumber, customerName: nombre, cuit })
    if (!ok) return NextResponse.json({ error: 'La entrada del registro no existe' }, { status: 404 })

    let movimiento = null
    let avisoSaldo: string | null = null
    if (cotizacion !== undefined) {
      movimiento = await actualizarCotizacionDeIngreso(registroId, cotizacion)
      if (!movimiento) {
        avisoSaldo = 'Los campos se guardaron, pero esta orden no tiene movimiento de balance (es anterior al corte), así que el saldo no cambió.'
      }
    }

    const cambios = [
      orderNumber !== undefined && `orden → ${orderNumber}`,
      nombre !== undefined && `nombre → ${nombre}`,
      cuit !== undefined && `cuit → ${cuit}`,
      cotizacion !== undefined && `cotización → ${cotizacion}`,
    ].filter(Boolean).join(' · ')

    await audit({
      category: 'user_action', action: 'registro.editar', result: 'success',
      actor: 'human', component: 'registro-editar',
      message: `Registro #${registroId} (${storeId}): ${cambios || 'sin cambios'}`,
    })

    return NextResponse.json({
      ok: true,
      usdt: movimiento?.usdt ?? null,
      usdtRate: movimiento?.usdtRate ?? null,
      avisoSaldo,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
