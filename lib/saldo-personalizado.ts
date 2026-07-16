import { randomUUID } from 'crypto'
import { insertRegistroEntry } from './registro'
import { registrarIngresoManual } from './balance'
import { toUTCISO } from './utils'
import type { LogEntry, Payment } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// "Añadir Saldo Personalizado" (admin): registra un ingreso manual a una TIENDA con
// los datos que carga el admin, y lo suma al balance.
//   • Entrada de registro con source='saldo_personalizado' (marcador: NO aparece en la
//     tabla de órdenes de la tienda) y payment.source = la billetera de origen elegida
//     (para que el ingreso cuente en esa billetera, igual que un pago normal).
//   • Movimiento 'ingreso_manual' con cotización MANUAL (usdt = monto / tasa), fechado
//     en la fecha del PAGO → figura en la SECCIÓN DE MOVIMIENTOS del extracto, en el día
//     de esa fecha, y cobra la comisión de la tienda (igual que una orden).
// La fecha/hora cargada es la del pago: se usa tal cual (no se corre 24 hs como los
// egresos), así el saldo cae en el día que se ingresó.
// ─────────────────────────────────────────────────────────────────────────────

export interface SaldoPersonalizadoInput {
  storeId: string
  storeName: string
  fechaHoraISO: string    // instante ISO del pago (la fecha/hora cargada)
  monto: number           // ARS a agregar
  tasa: number            // ARS/USDT
  billeteraSource: string // source del pago: billetera ('MF'…) o `otras:<nombre>`
  cuit?: string
  nombre?: string
  motivo?: string         // número de orden o motivo → columna "N° orden"
  createdBy: string       // email del admin (trazabilidad)
}

export async function agregarSaldoPersonalizado(input: SaldoPersonalizadoInput): Promise<void> {
  if (!Number.isFinite(input.tasa) || input.tasa <= 0) throw new Error('Falta la tasa ARS/USDT')
  const motivo = (input.motivo || '').trim()

  const payment: Payment = {
    mpPaymentId: `manual-${randomUUID()}`,
    monto: input.monto,
    nombrePagador: input.nombre || '',
    emailPagador: '',
    cuitPagador: input.cuit || '',
    referencia: motivo,
    operationId: '',
    metodoPago: 'manual',
    fechaPago: input.fechaHoraISO,
    status: 'approved',
    source: input.billeteraSource,   // billetera de origen → cuenta en esa billetera
    rawData: { manual: true, createdBy: input.createdBy },
  }

  const entry: LogEntry = {
    timestamp: input.fechaHoraISO,   // el saldo se ubica en el DÍA de la fecha ingresada
    action: 'manual_paid',
    source: 'saldo_personalizado',   // marcador: NO aparece en la tabla de órdenes de la tienda
    triggeredBy: 'human',
    payment,
    amount: input.monto,
    orderTotal: input.monto,
    orderNumber: motivo || undefined,
    storeId: input.storeId,
    storeName: input.storeName,
    customerName: input.nombre || undefined,
    cuitPagador: input.cuit || undefined,
    mpPaymentId: payment.mpPaymentId,
    paymentReceivedAt: toUTCISO(input.fechaHoraISO),
    hechoPor: input.createdBy,
  }
  const registroId = await insertRegistroEntry(entry)

  const usdt = input.monto / input.tasa
  // Concepto del movimiento = nombre del pagador + motivo (el tipo "Saldo personalizado"
  // ya se ve en su columna). Sin nombre, cae a "Saldo personalizado".
  const nombre = (input.nombre || '').trim()
  const concepto = `${nombre || 'Saldo personalizado'}${motivo ? ` · ${motivo}` : ''}`
  await registrarIngresoManual(input.storeId, registroId, input.monto, usdt, input.tasa,
    concepto, input.fechaHoraISO)
}
