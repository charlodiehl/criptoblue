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
import { kvKey } from './unidad'

// Cada unidad de negocio tiene su propia tabla de comisiones.
const KEY = () => kvKey('comisiones')

export const DEFAULT_COMISION_TIENDA = 3.5
export const DEFAULT_COMISION_BILLETERA = 1

// Comisión de tienda CON VIGENCIA: un cambio rige desde el día en que se hace; los
// días anteriores conservan lo que se cobraba. Se guarda como una lista de tramos
// { pct, desde } ordenada por fecha. Retrocompat: un número suelto = ese pct para
// TODA la historia (un único tramo desde el origen), así las tiendas que ya tenían
// un número no cambian en nada hasta el próximo cambio.
export interface TramoComision {
  pct: number
  desde: string   // 'YYYY-MM-DD' (ART), inclusive: ese día en adelante usa este pct
}

export interface ComisionesConfig {
  tiendas: Record<string, number | TramoComision[]>  // pct único (legacy) o tramos con vigencia
  billeteras: Record<string, number>                 // wallet → porcentaje (ej. 1)
}

// Fecha anterior a cualquier dato real: un número legacy vale "desde siempre".
const ORIGEN_COMISION = '2000-01-01'

// Día ART ('YYYY-MM-DD') de un timestamp. Argentina es UTC-3 fijo.
export function diaART(fecha: string | number | Date): string {
  const t = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime()
  return Number.isFinite(t) ? new Date(t - 3 * 3600_000).toISOString().slice(0, 10) : ''
}

export async function getComisiones(): Promise<ComisionesConfig> {
  const c = await kvGet<ComisionesConfig>(KEY())
  return { tiendas: c?.tiendas ?? {}, billeteras: c?.billeteras ?? {} }
}

// Tramos de una tienda, ordenados por `desde` asc. Un número legacy → un solo tramo
// desde el origen. Sin override → null (usa el default).
function tramosDeTienda(cfg: ComisionesConfig, storeId: string): TramoComision[] | null {
  const v = cfg.tiendas[storeId]
  if (typeof v === 'number') return Number.isFinite(v) ? [{ pct: v, desde: ORIGEN_COMISION }] : null
  if (Array.isArray(v)) {
    const t = v
      .filter(x => x && Number.isFinite(x.pct) && typeof x.desde === 'string')
      .sort((a, b) => a.desde.localeCompare(b.desde))
    return t.length ? t : null
  }
  return null
}

// Porcentaje vigente en un día ('YYYY-MM-DD' ART): el último tramo cuyo `desde` sea
// ≤ ese día. Si el día es anterior a todos los tramos (o no hay override), el default.
export function comisionTiendaEnFecha(cfg: ComisionesConfig, storeId: string, dia: string): number {
  const tramos = tramosDeTienda(cfg, storeId)
  if (!tramos) return DEFAULT_COMISION_TIENDA
  let pct = DEFAULT_COMISION_TIENDA
  for (const t of tramos) {
    if (t.desde <= dia) pct = t.pct
    else break
  }
  return pct
}

// Porcentaje vigente HOY (el del último tramo, o el número, o el default). Para
// mostrar y para contextos "actuales" — NO para agregados de períodos pasados.
export function comisionTiendaActual(cfg: ComisionesConfig, storeId: string): number {
  const tramos = tramosDeTienda(cfg, storeId)
  return tramos ? tramos[tramos.length - 1].pct : DEFAULT_COMISION_TIENDA
}

// ¿La comisión de la tienda cambió en el tiempo? (tramos con pct distintos). Si es
// false, un solo pct rige toda la historia → los agregados usan el camino rápido
// (idéntico al cálculo viejo). Si es true, hay que prorratear por día.
export function comisionTiendaVaria(cfg: ComisionesConfig, storeId: string): boolean {
  const tramos = tramosDeTienda(cfg, storeId)
  return !!tramos && new Set(tramos.map(t => t.pct)).size > 1
}

// Alias histórico: el pct vigente hoy. Los call sites de un solo día o de "mostrar el
// % actual" lo siguen usando; los agregados por período pasan a comisionTiendaEnFecha.
export function comisionTienda(cfg: ComisionesConfig, storeId: string): number {
  return comisionTiendaActual(cfg, storeId)
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
  if (Number.isFinite(v)) return v
  // "Otras" (cajón de pagos manuales sueltos) no cobra comisión; el resto, 1%.
  return wallet === 'Otras' ? 0 : DEFAULT_COMISION_BILLETERA
}

// Guarda el porcentaje de una entidad. pct 0..100.
//   • Billetera: un valor único (sin vigencia por fecha).
//   • Tienda: el cambio rige DESDE HOY. Se agrega un tramo { pct, desde: hoy } sin
//     tocar los anteriores, así los días pasados conservan lo que se cobraba. Si la
//     tienda tenía un número legacy, se preserva como tramo "desde siempre" para no
//     alterar el histórico. `dia` permite fijar el día (para tests).
export async function setComision(tipo: 'tienda' | 'billetera', id: string, pct: number, dia?: string): Promise<void> {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Porcentaje inválido (0 a 100)')
  const cfg = await getComisiones()
  if (tipo === 'billetera') {
    cfg.billeteras[id] = pct
    await kvSet(KEY(), cfg)
    return
  }
  const hoy = dia || diaART(new Date())
  const previos = tramosDeTienda(cfg, id) ?? []   // legacy number → [{pct, ORIGEN}]; sin override → []
  // Reemplaza el tramo de hoy si ya existía (varios cambios el mismo día) y agrega el nuevo.
  const nuevos = previos.filter(t => t.desde !== hoy)
  nuevos.push({ pct, desde: hoy })
  nuevos.sort((a, b) => a.desde.localeCompare(b.desde))
  cfg.tiendas[id] = nuevos
  await kvSet(KEY(), cfg)
}
