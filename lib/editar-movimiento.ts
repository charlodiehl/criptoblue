import { getClient } from './storage'

// ─────────────────────────────────────────────────────────────────────────────
// Edición de un movimiento del extracto (tienda o billetera): fecha, concepto,
// monto ARS y tasa. Mantiene COHERENCIA con las tablas ligadas según el tipo, para
// que no se descuadre ni el saldo de la tienda, ni el de la billetera, ni el tope de
// reembolso de una orden.
//
//   fuente 'balance' → balance_movements (extracto de la tienda):
//       ingreso_manual (saldo personalizado) → sincroniza registro_log (para la billetera)
//       reembolso                            → sincroniza refunds (tope de la orden + billetera)
//       ajuste                               → suelto
//       egreso_transferencia                 → solo fecha/concepto (el monto/tasa es multi-moneda; aparte)
//   fuente 'wallet'  → wallet_movements (retiros del extracto de la billetera)
//   fuente 'refund'  → un reembolso identificado por su id en refunds (se resuelve a su balance_movement)
// ─────────────────────────────────────────────────────────────────────────────

export interface EdicionMovimiento {
  fuente: 'balance' | 'wallet' | 'refund'
  id: number
  fecha?: string        // instante ISO
  concepto?: string
  montoArs?: number     // valor mostrado (positivo); el signo lo pone el tipo del movimiento
  tasa?: number         // cotización ARS/USDT (balance) o ARS/moneda (wallet)
}

const EPS = 1e-9

export async function editarMovimiento(e: EdicionMovimiento): Promise<{ avisoTransferencia?: boolean }> {
  if (e.fuente === 'wallet') { await editarSalida(e); return {} }
  if (e.fuente === 'refund') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getClient() as any
    const { data: rf, error } = await sb.from('refunds').select('id, ref_movement_id').eq('id', e.id).maybeSingle()
    if (error) throw new Error(`editarMovimiento(refund) falló: ${error.message} [${error.code}]`)
    if (!rf) throw new Error('Reembolso no encontrado')
    if (rf.ref_movement_id == null) throw new Error('Este reembolso no tiene movimiento de saldo asociado')
    return editarBalance({ ...e, fuente: 'balance', id: rf.ref_movement_id as number })
  }
  return editarBalance(e)
}

// ── balance_movements (tienda) ───────────────────────────────────────────────
async function editarBalance(e: EdicionMovimiento): Promise<{ avisoTransferencia?: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getClient() as any
  const { data: m, error } = await sb.from('balance_movements').select('*').eq('id', e.id).maybeSingle()
  if (error) throw new Error(`editarBalance(select) falló: ${error.message} [${error.code}]`)
  if (!m) throw new Error('Movimiento no encontrado')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {}
  if (e.fecha) patch.fecha = e.fecha
  if (e.concepto !== undefined) patch.descripcion = e.concepto

  const cambiaMonto = e.montoArs !== undefined || e.tasa !== undefined
  // Las transferencias tienen 5 monedas y un descuento compuesto: su monto/tasa se
  // edita aparte. Acá solo se permiten fecha/concepto (no se toca el saldo).
  const avisoTransferencia = cambiaMonto && m.tipo === 'egreso_transferencia'

  let absArs = Math.abs(Number(m.ars) || 0)
  let tasa = Number(m.usdt_rate) || 0
  if (cambiaMonto && !avisoTransferencia) {
    const signo = (Number(m.usdt) || 0) < 0 || (Number(m.ars) || 0) < 0 ? -1 : 1
    absArs = e.montoArs !== undefined ? Math.abs(e.montoArs) : absArs
    tasa = e.tasa !== undefined ? e.tasa : tasa
    if (!(absArs > 0)) throw new Error('El monto debe ser mayor a 0')
    if (!(tasa > 0)) throw new Error('La tasa (cotización) debe ser mayor a 0')
    patch.ars = signo * absArs
    patch.usdt = signo * (absArs / tasa)
    patch.usdt_rate = tasa
  }

  if (Object.keys(patch).length) {
    const { error: uErr } = await sb.from('balance_movements').update(patch).eq('id', e.id)
    if (uErr) throw new Error(`editarBalance(update) falló: ${uErr.message} [${uErr.code}]`)
  }

  // ── Sincronizar las tablas ligadas ──
  const absUsdt = tasa > EPS ? absArs / tasa : 0

  if (m.tipo === 'reembolso') {
    // El reembolso vive también en refunds (tope de la orden + saldo de la billetera).
    const rfPatch: Record<string, unknown> = {}
    if (cambiaMonto && !avisoTransferencia) { rfPatch.monto = absArs; rfPatch.usdt = absUsdt; rfPatch.cotizacion = tasa }
    if (e.fecha) rfPatch.created_at = e.fecha   // la billetera agrupa el reembolso por created_at
    if (Object.keys(rfPatch).length) {
      const { error: rErr } = await sb.from('refunds').update(rfPatch).eq('ref_movement_id', e.id)
      if (rErr) throw new Error(`editarBalance(refunds) falló: ${rErr.message} [${rErr.code}]`)
    }
  } else if (m.tipo === 'ingreso_manual' && m.ref_registro_id != null) {
    // El saldo personalizado vive también en registro_log (para la billetera de origen).
    const { data: rl } = await sb.from('registro_log').select('payment').eq('id', m.ref_registro_id).maybeSingle()
    const payment = { ...((rl?.payment as Record<string, unknown>) ?? {}) }
    const rlPatch: Record<string, unknown> = {}
    if (cambiaMonto && !avisoTransferencia) { payment.monto = absArs; rlPatch.amount = absArs }
    if (e.fecha) { payment.fechaPago = e.fecha; rlPatch.ts = e.fecha; rlPatch.payment_received_at = e.fecha }
    if (Object.keys(rlPatch).length || cambiaMonto) { rlPatch.payment = payment }
    if (Object.keys(rlPatch).length) {
      const { error: rlErr } = await sb.from('registro_log').update(rlPatch).eq('id', m.ref_registro_id)
      if (rlErr) throw new Error(`editarBalance(registro_log) falló: ${rlErr.message} [${rlErr.code}]`)
    }
  }

  return { avisoTransferencia }
}

// ── wallet_movements (retiros de billetera) ──────────────────────────────────
async function editarSalida(e: EdicionMovimiento): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getClient() as any
  const { data: s, error } = await sb.from('wallet_movements').select('*').eq('id', e.id).maybeSingle()
  if (error) throw new Error(`editarSalida(select) falló: ${error.message} [${error.code}]`)
  if (!s) throw new Error('Retiro no encontrado')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {}
  if (e.fecha) patch.fecha = e.fecha
  if (e.concepto !== undefined) patch.motivo = e.concepto

  const cambiaMonto = e.montoArs !== undefined || e.tasa !== undefined
  if (cambiaMonto) {
    const nuevoArs = e.montoArs !== undefined ? Math.abs(e.montoArs) : Number(s.ars) || 0
    if (!(nuevoArs > 0)) throw new Error('El monto (ARS que sale) debe ser mayor a 0')
    patch.ars = nuevoArs
    if (s.moneda === 'ARS') {
      // Retiro en pesos: no lleva cotización; el monto origen es el mismo ARS.
      patch.monto_origen = nuevoArs
      patch.cotizacion = null
    } else {
      // Retiro en USD/USDT: ars = monto_origen × cotización → monto_origen = ars / cotización.
      const cot = e.tasa !== undefined ? e.tasa : Number(s.cotizacion) || 0
      if (!(cot > 0)) throw new Error('La cotización (ARS por 1 ' + s.moneda + ') debe ser mayor a 0')
      patch.cotizacion = cot
      patch.monto_origen = nuevoArs / cot
    }
  }

  if (Object.keys(patch).length) {
    const { error: uErr } = await sb.from('wallet_movements').update(patch).eq('id', e.id)
    if (uErr) throw new Error(`editarSalida(update) falló: ${uErr.message} [${uErr.code}]`)
  }
}
