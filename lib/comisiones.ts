// ─────────────────────────────────────────────────────────────────────────────
// Comisiones por tienda y por billetera (config en criptoblue:comisiones).
//
// Se cobra una comisión sobre los INGRESOS (órdenes de una tienda / pagos de una
// billetera). El balance/ingresos se muestran SIEMPRE netos (con la comisión ya
// descontada). Guarda solo los overrides; lo no configurado usa los defaults.
//   • Tienda nueva  → 3,5%
//   • Billetera nueva → 1%
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet } from './storage'

const KEY = 'criptoblue:comisiones'

export const DEFAULT_COMISION_TIENDA = 3.5
export const DEFAULT_COMISION_BILLETERA = 1

export interface ComisionesConfig {
  tiendas: Record<string, number>    // storeId → porcentaje (ej. 3.5)
  billeteras: Record<string, number> // wallet   → porcentaje (ej. 1)
}

export async function getComisiones(): Promise<ComisionesConfig> {
  const c = await kvGet<ComisionesConfig>(KEY)
  return { tiendas: c?.tiendas ?? {}, billeteras: c?.billeteras ?? {} }
}

// Porcentaje de una tienda (override o default). cfg opcional para no re-leer.
export function comisionTienda(cfg: ComisionesConfig, storeId: string): number {
  const v = cfg.tiendas[storeId]
  return Number.isFinite(v) ? v : DEFAULT_COMISION_TIENDA
}

// Comisión en pesos/USDT que cobra una TIENDA sobre un ingreso bruto. NO es un pct%
// simple: el monto que entró se toma como el NETO, y la comisión es lo que hay que
// sumarle para llegar al bruto teórico.
//   comisión = monto / (1 − pct/100) − monto
// Ej: 1% sobre 10.000 → 10.000/0,99 − 10.000 = 101,01.
// Es lineal en el monto, así que da igual aplicarla por orden o sobre el total del día.
// (Las billeteras NO usan esto: cobran pct% directo — ver comisionBilletera.)
export function comisionTiendaSobre(monto: number, pct: number): number {
  if (!(monto > 0) || !(pct > 0) || pct >= 100) return 0
  return monto / (1 - pct / 100) - monto
}

export function comisionBilletera(cfg: ComisionesConfig, wallet: string): number {
  const v = cfg.billeteras[wallet]
  return Number.isFinite(v) ? v : DEFAULT_COMISION_BILLETERA
}

// Guarda el porcentaje de una entidad. pct 0..100.
export async function setComision(tipo: 'tienda' | 'billetera', id: string, pct: number): Promise<void> {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Porcentaje inválido (0 a 100)')
  const cfg = await getComisiones()
  if (tipo === 'tienda') cfg.tiendas[id] = pct
  else cfg.billeteras[id] = pct
  await kvSet(KEY, cfg)
}
