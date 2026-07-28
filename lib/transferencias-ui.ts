// ─────────────────────────────────────────────────────────────────────────────
// Cómo se MUESTRA una solicitud de transferencia. Compartido entre el detalle que
// ve la tienda (components/tienda/DetalleSolicitudModal) y el que opera el admin
// (components/finanzas/SolicitudModal), para que los dos lados llamen igual a lo
// mismo: si una pantalla dice "CBU / CVU / Alias", la otra no puede decir "cbu".
//
// Sin dependencias de servidor: lo importan componentes de cliente.
// Los campos salen de validarDatosSolicitud (lib/transferencias.ts) — al agregar
// uno nuevo allá, sumar acá su etiqueta.
// ─────────────────────────────────────────────────────────────────────────────

import type { TransferTipo } from './types'

export const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'Transferencia ARS',
  usd: 'Transferencia USD',
  usdt: 'Transferencia USDT',
  usd_billete: 'Recibir USD billete',
  ars_billete: 'Recibir ARS billete',
}

// Etiqueta legible de cada campo del formulario que llenó la tienda.
export const CAMPO_LABEL: Record<string, string> = {
  // ARS
  cbu: 'CBU / CVU / Alias',
  montoArs: 'Monto ARS',
  nombreBeneficiario: 'Nombre del beneficiario',
  cuitBeneficiario: 'CUIT / CUIL / DNI',
  // USD
  numeroCuenta: 'Número de cuenta',
  montoUsd: 'Monto USD',
  nombreCompleto: 'Nombre completo',
  domicilio: 'Domicilio',
  // USDT
  wallet: 'Wallet cripto',
  blockchain: 'Blockchain',
  montoUsdt: 'Monto USDT',
  // Billete (USD / ARS)
  monto: 'Monto',
  modalidad: 'Modalidad',
  dni: 'DNI',
  contacto: 'Contacto',
  direccion: 'Dirección de entrega',
}

// Orden en el que se muestran los campos. Primero quién recibe y dónde, después el
// monto: es el orden en que se leen para controlar una transferencia.
const ORDEN = [
  'nombreBeneficiario', 'nombreCompleto', 'cuitBeneficiario', 'dni',
  'cbu', 'numeroCuenta', 'wallet', 'blockchain',
  'domicilio', 'direccion', 'contacto', 'modalidad',
  'montoArs', 'montoUsd', 'montoUsdt', 'monto',
]

// La modalidad se guarda como 'retira'/'envio': se muestra en castellano.
export function valorLegible(campo: string, valor: unknown): string {
  if (campo === 'modalidad') {
    return valor === 'retira' ? 'Paso a retirar'
      : valor === 'envio' ? 'Enviar a una ubicación'
        : String(valor)
  }
  if (campo.startsWith('monto') || campo === 'monto') {
    const n = Number(valor)
    if (Number.isFinite(n)) return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(valor ?? '')
}

// Los datos de la solicitud como pares [etiqueta, valor], listos para mostrar.
// Un campo que no esté en ORDEN igual se muestra (al final): mejor que se vea con
// su nombre crudo a que desaparezca del detalle.
export function camposDeSolicitud(datos: Record<string, unknown> | null | undefined): { label: string; valor: string }[] {
  if (!datos) return []
  const claves = Object.keys(datos)
  claves.sort((a, b) => {
    const ia = ORDEN.indexOf(a), ib = ORDEN.indexOf(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  return claves
    .filter(k => datos[k] !== undefined && datos[k] !== null && String(datos[k]).trim() !== '')
    .map(k => ({ label: CAMPO_LABEL[k] ?? k, valor: valorLegible(k, datos[k]) }))
}

// Monto pedido, con su moneda, según el tipo.
//
// Si el campo del monto no está o no es un número, devuelve '—' en vez de "NaN":
// en transfer_requests conviven las solicitudes de las tiendas con los retiros de
// billetera (lib/billetera-salidas.ts), que guardan otros campos. Una solicitud
// vieja o de otra forma se ve incompleta, pero nunca rota.
export function montoDeSolicitud(tipo: TransferTipo, datos: Record<string, unknown> | null | undefined): string {
  const d = datos ?? {}
  const fmt = (v: unknown, moneda: string) => {
    const n = Number(v)
    return Number.isFinite(n)
      ? `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`
      : '—'
  }
  switch (tipo) {
    case 'ars': return fmt(d.montoArs, 'ARS')
    case 'usd': return fmt(d.montoUsd, 'USD')
    case 'usdt': return fmt(d.montoUsdt, 'USDT')
    case 'usd_billete': return fmt(d.monto, 'USD')
    case 'ars_billete': return fmt(d.monto, 'ARS')
    default: return '—'
  }
}
