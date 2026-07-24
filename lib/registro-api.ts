import { getClient } from '@/lib/storage'
import { getComisiones, comisionTiendaEnFecha, comisionTiendaSobre } from '@/lib/comisiones'

// ─────────────────────────────────────────────────────────────────────────────
// Motor por RANGO para la API pública (GET /api/v1/registro). Envuelve la misma
// cuenta que getBalanceDia (lib/balance.ts) pero sobre un rango de días, con UN
// query a balance_movements + lookups en bloque (registro_log para el pagador,
// transfer_requests para el retiro original, y el N° de orden del reembolso).
// Misma fuente de verdad que el panel → los números coinciden.
// ─────────────────────────────────────────────────────────────────────────────

export interface OrdenIngreso {
  orden: string | null
  hora: string                 // ISO con offset -03:00
  pagador: string | null       // payment.nombrePagador; null si se marcó a mano sin pago
  concepto: string             // "Ventas" por defecto; o el que puso la tienda (reclamo sin orden)
  ars: number
  cotizacion: number | null    // null = cotización pendiente al momento de la orden
  usdt: number | null
  comision_usdt: number | null
}
export interface RetiroDetalle {
  descripcion: string
  concepto: string             // el que puso la tienda; "Transferencia" por defecto
  moneda_retiro: string | null // moneda ORIGINAL del retiro (ARS/USD/USDT/…)
  monto_retiro: number | null  // monto en esa moneda (NO forzado a pesos)
  cotizacion: number | null    // tasa usada; null si el retiro fue en USDT directo
  usdt: number                 // USDT descontado del saldo
}
export interface ReembolsoDetalle { orden: string | null; concepto: string; ars: number; usdt: number }
export interface SaldoPersonalizado { descripcion: string; concepto: string; ars: number; usdt: number; sin_comision: boolean }
export interface AjusteDetalle { descripcion: string; concepto: string | null; ars: number; usdt: number }

export interface RegistroDia {
  fecha: string
  ingresos: { ars: number; usdt: number; cantidad: number; ordenes: OrdenIngreso[] }
  comision: { pct: number; ars: number; usdt: number }
  saldo_personalizado: SaldoPersonalizado[]
  retiros_transferencias: RetiroDetalle[]
  reembolsos: ReembolsoDetalle[]
  ajustes: AjusteDetalle[]
  saldo_neto_dia_usdt: number
}
export interface RegistroRango {
  tienda: string
  storeId: string
  moneda_saldo: 'USDT'
  desde: string
  hasta: string
  dias: RegistroDia[]
}

interface Mov {
  id: number; tipo: string; fecha: string; ars: number; usdt: number | null
  usdtRate: number | null; refRegistroId: number | null; refTransferId: number | null
  descripcion: string; sinComision: boolean
}

const r2n = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

// Día ART (UTC-3 fijo) de un instante UTC → 'YYYY-MM-DD'.
const artDay = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
// Hora ART con offset explícito, sin milisegundos: '2026-07-20T09:06:04-03:00'.
const artHora = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 19) + '-03:00'
// Nº de orden: '—' (placeholder de "sin orden") y vacío → null.
const normOrden = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return !s || s === '—' ? null : s
}
const ordenDeDescripcion = (desc: string): string | null => normOrden(desc.match(/#(\S+)/)?.[1] ?? null)

// Lista de días ART entre desde y hasta inclusive. Argentina es UTC-3 fijo, así que
// anclando a las 03:00 UTC cada paso de 24h cae en el mismo horario y el slice da el día.
function rangoDias(desde: string, hasta: string): string[] {
  const out: string[] = []
  const t0 = new Date(`${desde}T00:00:00-03:00`).getTime()
  const t1 = new Date(`${hasta}T00:00:00-03:00`).getTime()
  for (let t = t0; t <= t1; t += 24 * 3600_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

// PostgREST limita el largo de la URL: los .in() se parten en lotes.
async function inEnLotes<T>(ids: number[], fn: (lote: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 500) out.push(...await fn(ids.slice(i, i + 500)))
  return out
}

export async function getRegistroRango(storeId: string, tienda: string, desde: string, hasta: string): Promise<RegistroRango> {
  const sb = getClient()   // acotado a la unidad de la API key (ver validarApiKey)
  const cfg = await getComisiones()

  const desdeISO = new Date(`${desde}T00:00:00-03:00`).toISOString()
  const hastaISO = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 24 * 3600_000).toISOString()

  const { data: rows, error } = await sb.from('balance_movements')
    .select('id, tipo, fecha, ars, usdt, usdt_rate, ref_registro_id, ref_transfer_id, descripcion, sin_comision')
    .eq('store_id', storeId).gte('fecha', desdeISO).lt('fecha', hastaISO).order('fecha', { ascending: true })
  if (error) throw new Error(`balance_movements: ${error.message} [${error.code}]`)

  const movs: Mov[] = (rows ?? []).map(r => ({
    id: r.id as number, tipo: r.tipo as string, fecha: r.fecha as string, ars: Number(r.ars),
    usdt: r.usdt === null ? null : Number(r.usdt), usdtRate: r.usdt_rate === null ? null : Number(r.usdt_rate),
    refRegistroId: (r.ref_registro_id ?? null) as number | null, refTransferId: (r.ref_transfer_id ?? null) as number | null,
    descripcion: (r.descripcion ?? '') as string, sinComision: r.sin_comision === true,
  }))

  // Lookups en bloque: pagador (registro_log) y detalle del retiro (transfer_requests).
  // Órdenes y saldo personalizado leen su entrada de registro_log (pagador + concepto).
  const regIds = [...new Set(movs.filter(m => (m.tipo === 'ingreso_orden' || m.tipo === 'ingreso_manual') && m.refRegistroId != null).map(m => m.refRegistroId as number))]
  const trIds = [...new Set(movs.filter(m => m.tipo === 'egreso_transferencia' && m.refTransferId != null).map(m => m.refTransferId as number))]

  const regMap = new Map<number, { orden: string | null; pagador: string | null; concepto: string | null }>()
  if (regIds.length) {
    const regs = await inEnLotes(regIds, async (lote) => {
      const { data } = await sb.from('registro_log').select('id, order_number, concepto, nombre:payment->>nombrePagador').in('id', lote)
      return data ?? []
    })
    for (const rr of regs) regMap.set(rr.id as number, {
      orden: normOrden(rr.order_number as string | null),
      pagador: (rr.nombre as string | null) || null,
      concepto: ((rr.concepto as string | null) || '').trim() || null,
    })
  }

  const trMap = new Map<number, { moneda: string | null; monto: number | null; cotizacion: number | null; concepto: string | null }>()
  if (trIds.length) {
    const trs = await inEnLotes(trIds, async (lote) => {
      const { data } = await sb.from('transfer_requests').select('id, descuento, concepto').in('id', lote)
      return data ?? []
    })
    for (const t of trs) {
      const d = (t.descuento ?? {}) as Record<string, unknown>
      const cot = (d.cotizacionUsdtArs ?? d.tasaUsdtUsd ?? null) as number | null   // ARS→USDT/ARS, USD→USDT/USD, USDT→null
      trMap.set(t.id as number, {
        moneda: (d.moneda ?? null) as string | null,
        monto: Number.isFinite(Number(d.monto)) ? Number(d.monto) : null,
        cotizacion: Number.isFinite(Number(cot)) ? Number(cot) : null,
        concepto: ((t.concepto as string | null) || '').trim() || null,
      })
    }
  }

  // Agrupar por día ART.
  const porDia = new Map<string, Mov[]>()
  for (const m of movs) {
    const dia = artDay(m.fecha)
    const arr = porDia.get(dia)
    if (arr) arr.push(m)
    else porDia.set(dia, [m])
  }

  // El % vigente de CADA día (con tramos, los días pasados conservan su comisión).
  const dias: RegistroDia[] = rangoDias(desde, hasta).map(dia => armarDia(dia, porDia.get(dia) ?? [], comisionTiendaEnFecha(cfg, storeId, dia), regMap, trMap))
  return { tienda, storeId, moneda_saldo: 'USDT', desde, hasta, dias }
}

function armarDia(
  fecha: string, dm: Mov[], pct: number,
  regMap: Map<number, { orden: string | null; pagador: string | null; concepto: string | null }>,
  trMap: Map<number, { moneda: string | null; monto: number | null; cotizacion: number | null; concepto: string | null }>,
): RegistroDia {
  const esIngreso = (m: Mov) => m.tipo === 'ingreso_orden'
  const esGravado = (m: Mov) => (m.tipo === 'ingreso_orden' || m.tipo === 'ingreso_manual') && !m.sinComision
  const sum = (fn: (m: Mov) => number, filt: (m: Mov) => boolean) => dm.filter(filt).reduce((a, m) => a + fn(m), 0)

  const ingresosArs = sum(m => m.ars, esIngreso)
  const ingresosUsdt = sum(m => m.usdt ?? 0, esIngreso)
  const comisionArs = comisionTiendaSobre(sum(m => m.ars, esGravado), pct)
  const comisionUsdt = comisionTiendaSobre(sum(m => m.usdt ?? 0, esGravado), pct)
  const brutoUsdt = dm.reduce((a, m) => a + (m.usdt ?? 0), 0)

  const ordenes: OrdenIngreso[] = dm.filter(esIngreso).map(m => {
    const reg = m.refRegistroId != null ? regMap.get(m.refRegistroId) : undefined
    return {
      orden: reg?.orden ?? ordenDeDescripcion(m.descripcion),
      hora: artHora(m.fecha),
      pagador: reg?.pagador ?? null,
      concepto: reg?.concepto ?? 'Ventas',   // default venta; o el que puso la tienda (reclamo sin orden)
      ars: r2n(m.ars),
      cotizacion: m.usdtRate == null ? null : r2n(m.usdtRate),
      usdt: m.usdt == null ? null : r2n(m.usdt),
      comision_usdt: m.usdt == null ? null : r2n(comisionTiendaSobre(m.usdt, pct)),
    }
  })

  const saldo_personalizado: SaldoPersonalizado[] = dm.filter(m => m.tipo === 'ingreso_manual').map(m => {
    const reg = m.refRegistroId != null ? regMap.get(m.refRegistroId) : undefined
    return { descripcion: m.descripcion, concepto: reg?.concepto ?? 'Saldo', ars: r2n(m.ars), usdt: r2n(m.usdt ?? 0), sin_comision: m.sinComision }
  })

  const retiros_transferencias: RetiroDetalle[] = dm.filter(m => m.tipo === 'egreso_transferencia').map(m => {
    const t = m.refTransferId != null ? trMap.get(m.refTransferId) : undefined
    return {
      descripcion: m.descripcion,
      concepto: t?.concepto ?? 'Transferencia',
      moneda_retiro: t?.moneda ?? null,
      monto_retiro: t?.monto ?? null,
      cotizacion: t?.cotizacion ?? null,
      usdt: r2n(Math.abs(m.usdt ?? 0)),
    }
  })

  const reembolsos: ReembolsoDetalle[] = dm.filter(m => m.tipo === 'reembolso')
    .map(m => ({ orden: ordenDeDescripcion(m.descripcion), concepto: 'Reembolso', ars: r2n(Math.abs(m.ars)), usdt: r2n(Math.abs(m.usdt ?? 0)) }))

  const ajustes: AjusteDetalle[] = dm.filter(m => m.tipo === 'ajuste')
    .map(m => ({ descripcion: m.descripcion, concepto: null, ars: r2n(m.ars), usdt: r2n(m.usdt ?? 0) }))

  return {
    fecha,
    ingresos: { ars: r2n(ingresosArs), usdt: r2n(ingresosUsdt), cantidad: dm.filter(esIngreso).length, ordenes },
    comision: { pct, ars: r2n(comisionArs), usdt: r2n(comisionUsdt) },
    saldo_personalizado,
    retiros_transferencias,
    reembolsos,
    ajustes,
    saldo_neto_dia_usdt: r2n(brutoUsdt - comisionUsdt),
  }
}
