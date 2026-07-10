// ─────────────────────────────────────────────────────────────────────────────
// Salidas de billetera: retiros y transferencias que bajan el saldo.
//
// Espejo del flujo de tiendas (transfer_requests → movimiento), pero el saldo de
// billetera vive en ARS, no en USDT, así que tiene su propio libro: wallet_movements.
//
// Convención: `ars` es POSITIVO y dice cuánto SALE. getIngresosBilletera lo resta.
// Dos tipos, los que pidió el usuario:
//   • transferencia_ars → monto en ARS, directo.
//   • usd_billete       → monto en USD + cotización → ars = usd × usd_rate.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from '@supabase/supabase-js'

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

export type SalidaTipo = 'transferencia_ars' | 'usd_billete' | 'ajuste'

export interface SalidaBilletera {
  id: number
  wallet: string
  tipo: SalidaTipo
  fecha: string
  ars: number          // POSITIVO: lo que sale
  usd: number | null
  usdRate: number | null
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
    usd: r.usd == null ? null : Number(r.usd),
    usdRate: r.usd_rate == null ? null : Number(r.usd_rate),
    motivo: r.motivo ?? '',
    refTransferId: r.ref_transfer_id ?? null,
    createdBy: r.created_by ?? '',
  }
}

// Calcula el ARS que sale, según el tipo. Única fuente del cálculo: el endpoint
// no debe hacer la cuenta por su cuenta.
export function calcularSalidaArs(
  tipo: SalidaTipo,
  datos: { montoArs?: number; montoUsd?: number; cotizacion?: number },
): { ars: number; usd: number | null; usdRate: number | null } {
  const pos = (v: number | undefined, nombre: string): number => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Valor inválido: ${nombre}`)
    return n
  }
  if (tipo === 'usd_billete') {
    const usd = pos(datos.montoUsd, 'Monto USD')
    const rate = pos(datos.cotizacion, 'Cotización ARS/USD')
    return { ars: usd * rate, usd, usdRate: rate }
  }
  return { ars: pos(datos.montoArs, 'Monto ARS'), usd: null, usdRate: null }
}

// Registra la salida. `fecha` es el momento real del retiro (puede ser pasado).
export async function registrarSalida(input: {
  wallet: string
  tipo: SalidaTipo
  fecha: string
  ars: number
  usd?: number | null
  usdRate?: number | null
  motivo: string
  refTransferId?: number | null
  createdBy: string
}): Promise<SalidaBilletera> {
  if (!(input.ars > 0)) throw new Error('El monto de la salida debe ser mayor a 0')
  const { data, error } = await getClient()
    .from(TABLE)
    .insert({
      wallet: input.wallet,
      tipo: input.tipo,
      fecha: input.fecha,
      ars: input.ars,
      usd: input.usd ?? null,
      usd_rate: input.usdRate ?? null,
      motivo: input.motivo,
      ref_transfer_id: input.refTransferId ?? null,
      created_by: input.createdBy,
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
      .from(TABLE)
      .select('wallet, ars')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
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
      .from(TABLE)
      .select('*')
      .eq('wallet', wallet)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
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
  wallet: string, tipo: SalidaTipo, datos: Record<string, string | number>, createdBy: string,
): Promise<number> {
  // transfer_requests.tipo usa el vocabulario de las tiendas: 'ars' | 'usd_billete'
  const tipoRequest = tipo === 'usd_billete' ? 'usd_billete' : 'ars'
  const { data, error } = await getClient()
    .from(REQUESTS)
    .insert({ store_id: null, wallet, tipo: tipoRequest, estado: 'pendiente', datos, created_by: createdBy })
    .select('id')
    .single()
  if (error) throw new Error(`crearSolicitudBilletera falló: ${error.message} [${error.code}]`)
  return data.id as number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listarSolicitudesBilletera(wallet: string): Promise<any[]> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .select('*')
    .eq('wallet', wallet)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listarSolicitudesBilletera falló: ${error.message} [${error.code}]`)
  return data ?? []
}

// CLAIM condicional: solo la paga quien la encuentra 'pendiente'. Evita el doble
// egreso si dos admins confirman a la vez (mismo patrón que marcarPagada de tiendas).
export async function marcarSolicitudPagada(id: number, paidBy: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from(REQUESTS)
    .update({ estado: 'pagada', paid_at: new Date().toISOString(), paid_by: paidBy })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) throw new Error(`marcarSolicitudPagada falló: ${error.message} [${error.code}]`)
  return (data?.length ?? 0) > 0
}
