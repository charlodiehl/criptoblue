import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getStores, loadHotState, saveHotState } from '@/lib/storage'
import { updateRegistroPorId, getRegistroBasico } from '@/lib/registro'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import type { Order } from '@/lib/types'
import { markOrderAsPaid as markTNPaid } from '@/lib/tiendanube'
import { markOrderAsPaid as markShopifyPaid } from '@/lib/shopify'
import { actualizarCotizacionDeIngreso } from '@/lib/balance'
import { audit } from '@/lib/audit'

// POST /api/finanzas/registro/editar
//   { registroId, storeId, cotizacion?, cuit?, nombre?, orderNumber? }
//
// Campos que el admin puede corregir de una orden ya registrada. No se tocan monto
// ni fecha: eso movería el saldo por la puerta de atrás.
//
// La edición NO bloquea por ningún motivo (a veces se marca mal y hay que corregir).
//
// Al cambiar el número de orden, se REASOCIA el pago:
//   • Se vuelcan al registro TODOS los datos de la orden nueva (número, order_id, total,
//     fecha, cliente, tienda y el order_data completo), no solo el número: si no, la
//     entrada queda mezclada con el cliente y el total de la orden anterior. El pagador
//     (payment.nombrePagador) no se toca: es dato del pago, no de la orden.
//   • Se marca la orden NUEVA como pagada en la tienda (best-effort, igual que el
//     emparejamiento normal: si TN responde 403/422 solo queda una nota).
//   • La orden VIEJA se des-asocia en la app (el match reciente pasa a la nueva). Su
//     estado en Tiendanube NO se toca —TN no permite "despagar"—: se corrige a mano.
//     Como quedó pagada, igual sale sola de la app.
//
// El saldo solo cambia si cambia la cotización: se recalcula el USDT del ingreso.
const PAGADA = ['paid', 'authorized']

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

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

    // ── Reasociación de orden (solo si el número cambió) ──────────────────────────
    let mensajeOrden: string | null = null
    let orderId: string | null | undefined = undefined   // se patchea solo si hay orden nueva
    let ordenNueva: Order | undefined = undefined        // datos completos, si se encontró

    if (orderNumber !== undefined) {
      const basico = await getRegistroBasico(registroId)
      if (!basico) return NextResponse.json({ error: 'La entrada del registro no existe' }, { status: 404 })

      if (String(basico.orderNumber ?? '') !== orderNumber) {
        const store = (await getStores())[storeId]
        if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

        // Buscar la orden NUEVA en la tienda (id + estado). Si falla, se guarda igual.
        let nueva = null
        try { nueva = await buscarOrdenEnTienda(store, orderNumber) } catch { /* se guarda sin reasociar */ }
        orderId = nueva?.order.orderId ?? null
        ordenNueva = nueva?.order

        // Marcar la orden NUEVA como pagada (si existe y no lo estaba).
        let marcado: { success: boolean; method?: string; error?: string } | null = null
        if (nueva && orderId && !PAGADA.includes(String(nueva.paymentStatus))) {
          marcado = (store.platform ?? 'tiendanube') === 'shopify'
            ? await markShopifyPaid(storeId, store.accessToken, orderId, nueva.order.total)
            : await markTNPaid(storeId, store.accessToken, orderId)
        }

        // Des-asociar la VIEJA en la app: el match reciente del pago apunta a la nueva.
        if (basico.mpPaymentId) {
          const hot = await loadHotState()
          const rm = (hot.recentMatches ?? []).find(m => m.mpPaymentId === basico.mpPaymentId)
          if (rm) {
            rm.orderId = orderId ?? rm.orderId
            rm.storeId = storeId
            if (nueva) rm.order = nueva.order
            await saveHotState(hot)
          }
        }

        const partes = [`Pago reasociado a la orden #${orderNumber}`]
        if (marcado) {
          partes.push(marcado.success
            ? (marcado.method === 'note' ? 'la nueva no se pudo marcar en TN (quedó una nota)' : 'orden nueva marcada pagada')
            : `no se pudo marcar la orden nueva: ${marcado.error || 'error de Tiendanube'}`)
        } else if (nueva) {
          partes.push('la orden nueva ya estaba pagada')
        } else {
          partes.push('la orden nueva no se encontró en la tienda (se guardó igual)')
        }
        if (basico.orderNumber) partes.push(`orden vieja #${basico.orderNumber} des-asociada — corregí su estado en Tiendanube a mano`)
        mensajeOrden = partes.join(' · ')
      }
    }

    const ok = await updateRegistroPorId(registroId, { orderNumber, orderId, order: ordenNueva, customerName: nombre, cuit, hechoPor: auth.user.email })
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
      mensajeOrden,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
