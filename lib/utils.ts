// Utilidades compartidas entre componentes

import { PAYMENT_SOURCE_NAMES, PAYMENT_SOURCE_TO_WALLET, WALLETS } from './config'

// Resuelve el payment.source de un pago a su billetera. Tolerante con datos
// históricos "sucios": además de las claves canónicas (mercadopago, fiwind, …),
// reconoce cuando el source quedó guardado como el nombre de la billetera (MF,
// Lacar, …) o su nombre para mostrar (Mileidy = mercadopago → MF).
// SEGURO: lo que no se identifica (sin source, "-", un nombre suelto) cae en
// "Otras" — NUNCA devuelve null. Todo pago tiene que caer en alguna billetera:
// antes los desconocidos se descartaban en silencio y la suma por billetera no
// cuadraba contra la suma por tienda.
// Vive acá (y no en billeteras.ts) para que la escritura del registro pueda usarla
// sin ciclos de import.
const WALLET_SET = new Set<string>(WALLETS as readonly string[])

// Billetera del source, o null si NO se identifica con ninguna. Uso interno: la
// versión pública (resolveWallet) nunca devuelve null.
function resolveWalletEstricto(source?: string | null): string | null {
  if (!source) return null
  // Pagos manuales cargados a "Otras": source = `otras:<nombre libre>`.
  if (source.startsWith('otras:')) return 'Otras'
  const canon = PAYMENT_SOURCE_TO_WALLET[source]
  if (canon) return canon
  if (WALLET_SET.has(source)) return source
  const srcKey = Object.entries(PAYMENT_SOURCE_NAMES).find(([, disp]) => disp === source)?.[0]
  return srcKey ? (PAYMENT_SOURCE_TO_WALLET[srcKey] ?? null) : null
}

export function resolveWallet(source?: string | null): string {
  return resolveWalletEstricto(source) ?? 'Otras'
}

// ¿El source identifica una billetera concreta del sistema? false = no se pudo
// identificar (sin source, "-", un nombre suelto) y por lo tanto cae en "Otras".
// Lo usa la escritura del registro para normalizar el source antes de guardarlo.
export function billeteraIdentificada(source?: string | null): boolean {
  return resolveWalletEstricto(source) !== null
}

// Nombre amigable de la billetera/medio de pago desde payment.source ('fiwind' → 'MF', etc.)
// Un pago sin billetera identificable cae en "Otras" (antes decía 'MercadoPago', que ni
// siquiera es una billetera del sistema: atribuía el pago a una billetera equivocada).
export function billeteraLabel(source?: string): string {
  if (!source) return 'Otras'
  // Cajón "Otras": el source es `otras:<nombre libre>`.
  if (source.startsWith('otras:')) {
    const detalle = source.slice(6).trim()
    return detalle ? `Otras · ${detalle}` : 'Otras'
  }
  return PAYMENT_SOURCE_NAMES[source] ?? source
}

// A qué billetera pertenece el DINERO de un pago, según su source (para el saldo
// de cada billetera). No tiene que ver con las tiendas: el emparejamiento no se
// restringe por billetera. null = source no mapeado.
export function paymentWalletId(source?: string): string | null {
  if (!source) return null
  return PAYMENT_SOURCE_TO_WALLET[source] ?? null
}

// Devuelve el timestamp actual en hora Argentina (UTC-3) como ISO 8601
// Ej: "2026-04-09T15:23:45.000-03:00" cuando son las 18:23 UTC
// Al parsearlo con new Date() vuelve al instante UTC correcto → los cálculos de corte siguen funcionando
export function nowART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace('Z', '-03:00')
}

// Devuelve la fecha actual en Argentina como "YYYY-MM-DD" (para claves de audit log, etc.)
export function todayART(): string {
  return nowART().slice(0, 10)
}

// Mes actual en hora Argentina (UTC-3) como "YYYY-MM". ÚNICA fuente del mes para
// las tarjetas de stats y su acumulación: evita el desfase UTC/ART en el borde del
// mes (después de las 21hs ART el UTC ya está en el mes siguiente).
export function monthKeyART(): string {
  return nowART().slice(0, 7)
}

// Normaliza cualquier ISO (con offset -03:00, UTC Z, etc.) a UTC canónico.
// Se usa para payment_received_at, que es texto en la DB: si todos los valores
// están en el mismo formato (UTC), el orden alfabético coincide con el cronológico.
export function toUTCISO(iso: string): string {
  if (!iso) return iso
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toISOString()
}

// Los egresos de saldo (transferencias y reembolsos confirmados) se anotan 24 hs
// ANTES del momento del pago, para que en el registro de la tienda (y su billetera)
// caigan en el DÍA ANTERIOR y se descuenten del saldo diario de ese día. No cambia
// el saldo total, solo el día en que figura el egreso.
export function fechaEgresoSaldo(base: Date = new Date()): string {
  return new Date(base.getTime() - 24 * 60 * 60 * 1000).toISOString()
}

export const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  // Argentina es UTC-3 fijo (sin DST) — calculamos manualmente para evitar
  // que Intl.DateTimeFormat devuelva año en 2 dígitos en algunos browsers con locale es-AR
  const arg = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const dd   = String(arg.getUTCDate())
  const mm   = String(arg.getUTCMonth() + 1)
  const yyyy = arg.getUTCFullYear()
  const hh   = String(arg.getUTCHours()).padStart(2, '0')
  const min  = String(arg.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

export function matchesSearch(query: string, fields: (string | number | undefined | null)[]): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim().replace(/[$.,']/g, '')
  return fields.some(f => {
    if (f == null) return false
    return String(f).toLowerCase().replace(/[$.,']/g, '').includes(q)
  })
}
