// ─────────────────────────────────────────────────────────────────────────────
// Salidas de billetera: retiros y transferencias que bajan el saldo.
//
// Espejo del flujo de tiendas (transfer_requests → movimiento) y con los MISMOS
// cinco tipos, para que el operador no tenga que aprender dos formularios. La
// validación de los campos de cada tipo la hace validarDatosSolicitud, que ya es
// la fuente de verdad del portal de tiendas.
//
// Diferencia con las tiendas: el saldo de tienda vive en USDT y el de billetera en
// ARS. Por eso un retiro en USD o USDT necesita una cotización para descontarse, y
// se guarda en wallet_movements como (moneda, monto_origen, cotizacion) → ars.
//
// Convención: `ars` es POSITIVO y dice cuánto SALE. getIngresosBilletera lo resta.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { TransferTipo } from './types'

const TABLE = 'wallet_movements'
const REQUESTS = 'transfer_requests'

let _client: SupabaseClient | null = null
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _client
}

export const TIPOS_SALIDA: TransferTipo[] = ['ars', 'usd', 'usdt', 'usd_billete', 'ars_billete']

export const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'Transferencia ARS',
  usd: 'Transferencia USD',
  usdt: 'Transferencia USDT',
  usd_billete: 'Recibir USD billete',
  ars_billete: 'Recibir ARS billete',
}

export type MonedaSalida = 'ARS' | 'USD' | 'USDT'

// Qué moneda mueve cada tipo, y de qué campo del formulario sale el monto.
const MONEDA_DE: Record<TransferTipo, MonedaSalida> = {
  ars: 'ARS', ars_billete: 'ARS', usd: 'USD', usd_billete: 'USD', usdt: 'USDT',
}
const CAMPO_MONTO: Record<TransferTipo, string> = {
  ars: 'montoArs', usd: 'montoUsd', usdt: 'montoUsdt', usd_billete: 'monto', ars_billete: 'monto',
}

export interface SalidaBilletera {
  id: number
  wallet: string
  tipo: TransferTipo | 'ajuste'
  fecha: string
  ars: number                 // POSITIVO: lo que sale, ya convertido
  moneda: MonedaSalida
  montoOrigen: number         // el monto en la moneda del retiro
  cotizacion: number | null   // ARS por 1 unidad; null si el retiro ya era en ARS
  motivo: string
  refTransferId: number | null
  createdBy: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSalida(r: any): SalidaBilletera {
  return {
    id: r.id,
    wallet: r.wallet,
    tipo: r.tipo,
    fecha: r.fecha,
    ars: Number(r.ars) || 0,
    moneda: r.moneda,
    montoOrigen: Number(r.monto_origen) || 0,
    cotizacion: r.cotizacion == null ? null : Number(r.cotizacion),
    motivo: r.motivo ?? '',
    refTransferId: r.ref_transfer_id ?? null,
    createdBy: r.created_by ?? '',
  }
}

// Monto en la moneda del retiro, leído del campo que corresponde a su tipo.
export function montoDeSolicitud(tipo: TransferTipo, datos: Record<string, unknown>): number {
  const n = Number(datos[CAMPO_MONTO[tipo]])
  if (!Number.isFinite(n) || n <= 0) throw new Error('Monto inválido en la solicitud')
  return n
}

export function monedaDeTipo(tipo: TransferTipo): MonedaSalida {
  return MONEDA_DE[tipo]
}

// ÚNICA fuente del cálculo del ARS que sale. Los retiros en ARS no llevan
// cotización; los de USD/USDT la exigen (si falta, es un error, no un 0 silencioso).
export function calcularSalidaArs(
  tipo: TransferTipo, datos: Record<string, unknown>, cotizacion?: number,
): { ars: number; moneda: MonedaSalida; montoOrigen: number; cotizacion: number | null } {
  const moneda = MONEDA_DE[tipo]
  const montoOrigen = montoDeSolicitud(tipo, datos)
  if (moneda === 'ARS') return { ars: montoOrigen, moneda, montoOrigen, cotizacion: null }

  const c = Number(cotizacion)
  if (!Number.isFinite(c) || c <= 0) {
    throw new Error(`Falta la cotización ARS por 1 ${moneda} para descontar el retiro`)
  }
  return { ars: montoOrigen * c, moneda, montoOrigen, cotizacion: c }
}

export async function registrarSalida(input: {
  wallet: string
  tipo: TransferTipo | 'ajuste'
  fecha: string
  ars: number
  moneda: MonedaSalida
  montoOrigen: number
  cotizacion?: number | null
  motivo: string
  refTransferId?: number | null
  createdBy: string
}): Promise<SalidaBilletera> {
  if (!(input.ars > 0)) throw new Error('El monto de la salida debe ser mayor a 0')
  const { data, error } = await getClient()
    .from(TABLE)
    .insert({
      wallet: input.wallet, tipo: input.tipo, fecha: input.fecha, ars: input.ars,
      moneda: input.moneda, monto_origen: input.montoOrigen, cotizacion: input.cotizacion ?? null,
      motivo: input.motivo, ref_transfer_id: input.refTransferId ?? null, created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`registrarSalida falló: ${error.message} [${error.code}]`)
  return rowToSalida(data)
}

// Total ARS que salió de cada billetera. Paginado: es una suma de dinero sin cota
// temporal; truncarla dejaría el saldo inflado en silencio.
export async function sumSalidasByWallet(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await getClient()
      .from(TABLE).select('wallet, ars').order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`sumSalidasByWallet falló: ${error.message} [${error.code}]`)
    for (const r of data ?? []) out[r.wallet as string] = (out[r.wallet as string] ?? 0) + (Number(r.ars) || 0)
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

export async function getSalidasDeWallet(wallet: string): Promise<SalidaBilletera[]> {
  const out: SalidaBilletera[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await getClient()
      .from(TABLE).select('*').eq('wallet', wallet)
      .order('fecha', { ascending: false }).order('id', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getSalidasDeWallet falló: ${error.message} [${error.code}]`)
    out.push(...(data ?? []).map(rowToSalida))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// ─── Solicitudes de pago de una billetera (transfer_requests con wallet) ─────

export async function crearSolicitudBilletera(
  wallet: string, tipo: TransferTipo, datos: Record<string, string | number>, createdBy: string,
): Promise<number> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .insert({ store_id: null, wallet, tipo, estado: 'pendiente', datos, created_by: createdBy })
    .select('id')
    .single()
  if (error) throw new Error(`crearSolicitudBilletera falló: ${error.message} [${error.code}]`)
  return data.id as number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listarSolicitudesBilletera(wallet: string): Promise<any[]> {
  const { data, error } = await getClient()
    .from(REQUESTS).select('*').eq('wallet', wallet).order('created_at', { ascending: false })
  if (error) throw new Error(`listarSolicitudesBilletera falló: ${error.message} [${error.code}]`)
  return data ?? []
}

// CLAIM condicional: solo la paga quien la encuentra 'pendiente'. Evita el doble
// egreso si dos admins confirman a la vez (mismo patrón que marcarPagada de tiendas).
export async function marcarSolicitudPagada(id: number, paidBy: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .update({ estado: 'pagada', paid_at: new Date().toISOString(), paid_by: paidBy })
    .eq('id', id).eq('estado', 'pendiente').select('id')
  if (error) throw new Error(`marcarSolicitudPagada falló: ${error.message} [${error.code}]`)
  return (data?.length ?? 0) > 0
}
