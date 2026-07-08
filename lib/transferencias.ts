import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { TransferRequest, TransferTipo, TransferEstado, TransferDescuento } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Capa de datos de solicitudes de transferencia (tabla transfer_requests).
// La crea la tienda desde su portal; la paga el admin desde Administración
// Financiera (O2). Ciclo: pendiente → pagada (sin rechazo, decisión del usuario).
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'transfer_requests'

let _client: SupabaseClient | null = null
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTransfer(r: any): TransferRequest {
  return {
    id: r.id,
    storeId: r.store_id,
    tipo: r.tipo,
    estado: r.estado,
    datos: r.datos ?? {},
    createdBy: r.created_by,
    createdAt: r.created_at,
    paidAt: r.paid_at ?? null,
    paidBy: r.paid_by ?? null,
    comprobantePath: r.comprobante_path ?? null,
    descuento: r.descuento ?? null,
  }
}

// Valida y normaliza los campos del formulario según el tipo. Lanza Error con
// mensaje claro si falta un obligatorio. Es la fuente de verdad de qué campos
// exige cada tipo (espejo del formulario del portal).
export function validarDatosSolicitud(tipo: TransferTipo, datos: Record<string, unknown>): Record<string, string | number> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const num = (v: unknown) => Number(v)
  const reqStr = (v: unknown, nombre: string) => {
    const s = str(v)
    if (!s) throw new Error(`Falta un dato obligatorio: ${nombre}`)
    return s
  }
  const reqMonto = (v: unknown, nombre: string) => {
    const n = num(v)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Monto inválido: ${nombre}`)
    return n
  }

  switch (tipo) {
    case 'ars': {
      const out: Record<string, string | number> = {
        cbu: reqStr(datos.cbu, 'CBU/CVU/Alias'),
        montoArs: reqMonto(datos.montoArs, 'Monto ARS'),
      }
      if (str(datos.nombreBeneficiario)) out.nombreBeneficiario = str(datos.nombreBeneficiario)
      if (str(datos.cuitBeneficiario)) out.cuitBeneficiario = str(datos.cuitBeneficiario)
      return out
    }
    case 'usd':
      return {
        numeroCuenta: reqStr(datos.numeroCuenta, 'Número de cuenta'),
        montoUsd: reqMonto(datos.montoUsd, 'Monto USD'),
        nombreCompleto: reqStr(datos.nombreCompleto, 'Nombre completo del beneficiario'),
        domicilio: reqStr(datos.domicilio, 'Domicilio completo'),
      }
    case 'usdt':
      return {
        wallet: reqStr(datos.wallet, 'Wallet cripto del beneficiario'),
        blockchain: reqStr(datos.blockchain, 'Blockchain'),
        montoUsdt: reqMonto(datos.montoUsdt, 'Monto USDT'),
      }
    // Recibir billete (USD o ARS): monto + modalidad (paso a retirar / enviar a una
    // ubicación) con campos condicionales según la modalidad.
    case 'usd_billete':
    case 'ars_billete': {
      const modalidad = str(datos.modalidad)
      if (modalidad !== 'retira' && modalidad !== 'envio') {
        throw new Error('Elegí cómo querés recibir (paso a retirar / enviar a una ubicación)')
      }
      const out: Record<string, string | number> = {
        monto: reqMonto(datos.monto, 'Monto'),
        modalidad,
        nombreCompleto: reqStr(datos.nombreCompleto, modalidad === 'retira' ? 'Nombre completo de quien retira' : 'Nombre completo de quien recibe'),
        dni: reqStr(datos.dni, 'DNI'),
        contacto: reqStr(datos.contacto, 'Número de contacto'),
      }
      if (modalidad === 'envio') out.direccion = reqStr(datos.direccion, 'Dirección donde entregar')
      return out
    }
    default:
      throw new Error(`Tipo de transferencia desconocido: ${tipo}`)
  }
}

export async function crearSolicitud(
  storeId: string, tipo: TransferTipo, datos: Record<string, string | number>, createdBy: string,
): Promise<TransferRequest> {
  const { data, error } = await getClient()
    .from(TABLE)
    .insert({ store_id: storeId, tipo, estado: 'pendiente', datos, created_by: createdBy })
    .select('*')
    .single()
  if (error) throw new Error(`crearSolicitud falló: ${error.message} [${error.code}]`)
  return rowToTransfer(data)
}

export async function listarSolicitudesTienda(storeId: string): Promise<TransferRequest[]> {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listarSolicitudesTienda falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToTransfer)
}

export async function getSolicitudById(id: number): Promise<TransferRequest | null> {
  const { data, error } = await getClient().from(TABLE).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`getSolicitudById falló: ${error.message} [${error.code}]`)
  return data ? rowToTransfer(data) : null
}

// Todas las solicitudes (para el admin), opcionalmente filtradas por estado.
export async function listarSolicitudes(estado?: TransferEstado): Promise<TransferRequest[]> {
  let q = getClient().from(TABLE).select('*').order('created_at', { ascending: false })
  if (estado) q = q.eq('estado', estado)
  const { data, error } = await q
  if (error) throw new Error(`listarSolicitudes falló: ${error.message} [${error.code}]`)
  return (data ?? []).map(rowToTransfer)
}

// Marca una solicitud como pagada. CLAIM condicional: solo actualiza si sigue
// 'pendiente' → devuelve true si ESTE llamado la pagó (evita doble pago si dos
// admins la confirman a la vez). Guarda el descuento aplicado y el comprobante.
export async function marcarPagada(
  id: number, paidBy: string, descuento: TransferDescuento, comprobantePath: string | null,
): Promise<boolean> {
  const { data, error } = await getClient()
    .from(TABLE)
    .update({
      estado: 'pagada',
      paid_at: new Date().toISOString(),
      paid_by: paidBy,
      descuento,
      comprobante_path: comprobantePath,
    })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) throw new Error(`marcarPagada falló: ${error.message} [${error.code}]`)
  return (data?.length ?? 0) > 0
}

// Sube un comprobante al bucket privado 'comprobantes'. Devuelve el path guardado.
export async function subirComprobante(
  transferId: number, filename: string, bytes: ArrayBuffer, contentType: string,
): Promise<string> {
  const safe = (filename || 'comprobante').replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `transfer-${transferId}/${Date.now()}-${safe}`
  const { error } = await getClient().storage.from('comprobantes').upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error(`subirComprobante falló: ${error.message}`)
  return path
}

// URL firmada (temporal) para ver un comprobante subido a Storage.
export async function urlComprobante(path: string, segundos = 3600): Promise<string | null> {
  const { data, error } = await getClient().storage.from('comprobantes').createSignedUrl(path, segundos)
  if (error) return null
  return data?.signedUrl ?? null
}
