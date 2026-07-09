import { randomUUID } from 'crypto'
import { insertRegistroEntry } from './registro'
import { registrarIngresoManual } from './balance'
import { nowART, toUTCISO } from './utils'
import type { LogEntry, Payment } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// "Añadir Saldo Personalizado" (admin): registra un ingreso manual a una tienda o
// billetera, con los datos que carga el admin, y lo suma al balance.
//   • Tienda    → entrada de registro (manual_paid) + movimiento ingreso_orden con
//     cotización MANUAL (usdt = monto / tasa). Cuenta en la base de comisión.
//   • Billetera → entrada de registro con source = billetera (el saldo de billetera
//     es derivado y en ARS). No lleva tasa.
// La fecha/hora cargada es la del PAGO (columna "Fecha y hora"); la entrada se crea
// hoy (ts = ahora), así aparece en el día actual del balance de la tienda.
// ─────────────────────────────────────────────────────────────────────────────

export interface SaldoPersonalizadoInput {
  tipo: 'tienda' | 'billetera'
  id: string             // storeId (tienda) | nombre de billetera
  storeName?: string     // requerido si tipo='tienda'
  fechaHoraISO: string   // instante ISO del pago (la fecha/hora cargada)
  monto: number          // ARS a agregar
  tasa?: number          // ARS/USDT — requerido si tipo='tienda'
  cuit?: string
  nombre?: string
  motivo?: string        // número de orden o motivo → columna "N° orden"
  createdBy: string
}

function buildPayment(input: SaldoPersonalizadoInput, source: string): Payment {
  return {
    mpPaymentId: `manual-${randomUUID()}`,
    monto: input.monto,
    nombrePagador: input.nombre || '',
    emailPagador: '',
    cuitPagador: input.cuit || '',
    referencia: input.motivo || '',
    operationId: '',
    metodoPago: 'manual',
    fechaPago: input.fechaHoraISO,
    status: 'approved',
    source,
    rawData: { manual: true, createdBy: input.createdBy },
  }
}

export async function agregarSaldoPersonalizado(input: SaldoPersonalizadoInput): Promise<void> {
  const motivo = (input.motivo || '').trim()

  if (input.tipo === 'tienda') {
    if (!Number.isFinite(input.tasa) || (input.tasa as number) <= 0) throw new Error('Falta la tasa ARS/USDT')
    const tasa = input.tasa as number
    const payment = buildPayment(input, 'manual')  // source 'manual' → no cuenta en ninguna billetera
    const entry: LogEntry = {
      timestamp: nowART(),
      action: 'manual_paid',
      source: 'manual_ordenes',
      triggeredBy: 'human',
      payment,
      amount: input.monto,
      orderTotal: input.monto,
      orderNumber: motivo || undefined,
      storeId: input.id,
      storeName: input.storeName,
      customerName: input.nombre || undefined,
      cuitPagador: input.cuit || undefined,
      mpPaymentId: payment.mpPaymentId,
      paymentReceivedAt: toUTCISO(input.fechaHoraISO),
    }
    const registroId = await insertRegistroEntry(entry)
    const usdt = input.monto / tasa
    await registrarIngresoManual(input.id, registroId, input.monto, usdt, tasa,
      `Saldo personalizado${motivo ? ` · ${motivo}` : ''}`)
    return
  }

  // Billetera: solo entrada de registro con source = billetera (saldo derivado, ARS)
  const payment = buildPayment(input, input.id)
  const entry: LogEntry = {
    timestamp: nowART(),
    action: 'manual_paid',
    source: 'manual_ordenes',
    triggeredBy: 'human',
    payment,
    amount: input.monto,
    orderNumber: motivo || undefined,
    customerName: input.nombre || undefined,
    cuitPagador: input.cuit || undefined,
    mpPaymentId: payment.mpPaymentId,
    paymentReceivedAt: toUTCISO(input.fechaHoraISO),
  }
  await insertRegistroEntry(entry)
}
