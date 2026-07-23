import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getSolicitudById, marcarPagada } from '@/lib/transferencias'
import { calcularDescuento, registrarEgresoTransferencia } from '@/lib/balance'
import { getStores, loadLogs, saveLogs, appendError, appendActivity } from '@/lib/storage'
import { notifyTienda } from '@/lib/push'
import { audit } from '@/lib/audit'
import type { DescuentoMoneda } from '@/lib/types'

const MONEDAS: DescuentoMoneda[] = ['USDT', 'USD', 'ARS', 'USD_BILLETE', 'ARS_BILLETE']

// POST /api/finanzas/pagar-solicitud
//   { id, moneda, monto, tasas: {cotizacionUsdtArs?, tasaUsdtArs?, tasaUsdArs?, tasaUsdtUsd?}, comprobantePath? }
//
// El admin confirma el pago de una solicitud: calcula el descuento (calcularDescuento
// exige las tasas obligatorias según la moneda), marca la solicitud pagada y descuenta
// el saldo de la tienda en ARS y USDT.
//
// Orden a prueba de doble-pago: marcarPagada es un CLAIM condicional (solo si sigue
// pendiente). Si otro admin ya la pagó → 409 y no se descuenta. El egreso de balance
// es best-effort: si falla, la solicitud queda pagada con su descuento guardado y el
// movimiento se reconstruye desde ahí (no se bloquea la operación).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const { id, moneda, monto, tasas, comprobantePath } = body

    if (!Number.isFinite(Number(id))) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
    if (!MONEDAS.includes(moneda)) return NextResponse.json({ error: 'Moneda de descuento inválida' }, { status: 400 })

    const solicitud = await getSolicitudById(Number(id))
    if (!solicitud) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
    if (solicitud.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Esa solicitud ya fue pagada' }, { status: 409 })
    }

    // Calcular el descuento (valida tasas obligatorias según moneda)
    let descuento
    try {
      descuento = calcularDescuento(moneda, Number(monto), tasas ?? {})
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Tasas inválidas' }, { status: 400 })
    }

    // Claim condicional: solo la paga si sigue pendiente
    const claimed = await marcarPagada(solicitud.id, auth.user.email, descuento, comprobantePath ?? null)
    if (!claimed) {
      return NextResponse.json({ error: 'Esa solicitud ya fue pagada por otra persona' }, { status: 409 })
    }

    const stores = await getStores()
    const storeName = stores[solicitud.storeId]?.storeName ?? solicitud.storeId

    // Egreso de balance — best-effort (reconstruible desde solicitud.descuento).
    // El label lleva el concepto de la tienda (reemplaza "solicitud") y el #id como
    // referencia secundaria: "Transferencia ARS · Impuestos · #157". Sin concepto: "… · #157".
    const conceptoTxt = (solicitud.concepto || '').trim()
    const labelEgreso = `Transferencia ${solicitud.tipo.toUpperCase()}${conceptoTxt ? ` · ${conceptoTxt}` : ''} · #${solicitud.id}`
    try {
      await registrarEgresoTransferencia(solicitud.id, solicitud.storeId, descuento, labelEgreso)
    } catch (err) {
      const logs = await loadLogs()
      appendError(logs, 'finanzas', 'error',
        `Solicitud #${solicitud.id} marcada pagada pero NO se pudo descontar el saldo de ${storeName}. Reconstruir desde el descuento guardado.`,
        { transferId: solicitud.id, storeId: solicitud.storeId, error: String(err) })
      await saveLogs(logs)
    }

    // Actividad (informativo)
    try {
      const logs = await loadLogs()
      appendActivity(logs, 'human', 'solicitud_pagada', {
        transferId: solicitud.id, storeName, moneda, monto: Number(monto),
        arsDescontado: descuento.arsDescontado, usdtDescontado: descuento.usdtDescontado, pagadoPor: auth.user.email,
      })
      await saveLogs(logs)
    } catch { /* no bloquear por el log de actividad */ }

    audit({
      category: 'user_action', action: 'finanzas.solicitud_pagada', result: 'success', actor: 'human',
      component: 'api/finanzas/pagar-solicitud', storeId: solicitud.storeId, storeName,
      amount: descuento.usdtDescontado,
      message: `Solicitud #${solicitud.id} (${solicitud.tipo}) pagada por ${auth.user.email} — descontó ${descuento.usdtDescontado} USDT`,
    })

    // Avisarle a la tienda que ya le pagaron (best-effort: el pago ya está hecho).
    try {
      // El nombre del beneficiario vive en un campo distinto según el tipo, y en ARS
      // es opcional: se cae al CBU (o a la wallet en USDT, que no lleva nombre).
      const d = (solicitud.datos ?? {}) as Record<string, unknown>
      const beneficiario = String(d.nombreBeneficiario || d.nombreCompleto || d.wallet || d.cbu || '').trim()
      const montoTxt = descuento.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      await notifyTienda(solicitud.storeId, 'transferencia_pagada', {
        title: 'Transferencia pagada',
        body: `Se pagó tu transferencia de ${montoTxt} ${descuento.moneda}${beneficiario ? ` a ${beneficiario}` : ''}.`,
        url: '/tienda',
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true, descuento })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
