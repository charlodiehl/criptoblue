// ─────────────────────────────────────────────────────────────────────────────
// Métricas de Administración Financiera para un período [desde, hasta).
//
// Tiendas (USDT) y billeteras (ARS), en sus monedas nativas. "Saldo adeudado" =
// CAMBIO NETO DE SALDO en el período (decisión del usuario):
//   • Tiendas:    Σ balance_movements.usdt (signado) − comisión (grossed-up sobre
//                 los ingresos de órdenes del período). El BALANCE_CUTOFF de tiendas
//                 ya se respeta acá: las órdenes previas nunca generan movimiento, así
//                 que balance_movements no trae nada anterior al corte.
//   • Billeteras: saldo inicial del corte + (ingresos − comisión − reembolsos − salidas)
//                 del período, SOLO contando movimientos desde la fecha de corte de cada
//                 billetera (criptoblue:billetera-cortes). Lo anterior al corte ya está
//                 dentro del saldo inicial: contarlo de nuevo lo duplicaría.
//
// Órdenes emparejadas: matches (manual_paid/auto_paid) con ts en el período.
// Ingresos de billetera: pagos matcheados (por fechaPago) + cola (por fechaPago) del
//   período y ≥ corte de la billetera.
// Reembolsos solicitados: filas de refund_requests con created_at en el período.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, getStores, loadHotState } from './storage'
import { getComisiones, comisionTiendaSobre, comisionBilletera, comisionTiendaEnFecha, comisionTiendaActual, comisionTiendaVaria, diaART } from './comisiones'
import { walletsDeUnidad } from './unidad'
import { resolveWallet, getCortesBilletera } from './billeteras'
import { getUsdtRateSinMargen } from './cotizacion'

export interface MetricaTienda {
  storeId: string
  storeName: string
  netoUsdt: number      // cambio neto de saldo en el período (lo que se les debe por el período)
  volumenArs: number    // volumen BRUTO emparejado (ARS), sin descontar la comisión
  comisionArs: number   // comisión aportada = volumen emparejado (ARS) × pct de la tienda
  ordenes: number       // órdenes emparejadas en el período
}
export interface MetricaBilletera { wallet: string; netoArs: number }
export interface MetricaReembolsos { storeId: string; storeName: string; cantidad: number }

export interface Metricas {
  desde: string
  hasta: string
  ordenesTotal: number
  volumenTotalArs: number       // volumen BRUTO de todas las tiendas sumadas (ARS, sin comisión)
  saldoTiendasUsdt: number      // suma del cambio neto de todas las tiendas
  saldoTiendasArs: number | null  // el saldo USDT valuado a la cotización ACTUAL (null si la API falla)
  cotizacion: number | null     // ARS por 1 USDT usado para el estimado (última cotización, misma que ven las tiendas)
  saldoBilleterasArs: number    // suma del cambio neto de todas las billeteras
  reembolsosTotal: number
  tiendas: MetricaTienda[]              // ordenadas por neto desc
  billeteras: MetricaBilletera[]        // ordenadas por neto desc
  reembolsosPorTienda: MetricaReembolsos[]  // ordenadas por cantidad desc
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000
  const out: unknown[] = []
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) throw new Error(`métricas query falló: ${error.message} [${error.code}]`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return out as any[]
}

export async function getMetricas(desdeMs: number, hastaMs: number): Promise<Metricas> {
  const sb = getClient()
  const desdeISO = new Date(desdeMs).toISOString()
  const hastaISO = new Date(hastaMs).toISOString()
  const enRango = (t: number) => Number.isFinite(t) && t >= desdeMs && t < hastaMs

  // La cotización es SIEMPRE la última (precio de venta Binance P2P sin margen), la
  // misma que usan las tiendas para su "estimado en pesos". No depende del período:
  // aunque se elija una fecha pasada, el saldo USDT se valúa a la cotización de hoy.
  const [stores, cfg, hot, cortes, cotizacion] = await Promise.all([
    getStores(), getComisiones(), loadHotState(), getCortesBilletera(), getUsdtRateSinMargen(),
  ])
  // Nombre real de las tiendas que YA NO están conectadas: al desconectarlas salen de
  // `stores` pero su historial queda, y antes se mostraba el storeId pelado (un número
  // suelto en las métricas). Cada fila del registro guarda su store_name: se usa como
  // respaldo para que sigan figurando con su nombre. Se llena al recorrer `matched`.
  const nombreEnRegistro = new Map<string, string>()
  const nombreTienda = (id: string) => stores[id]?.storeName ?? nombreEnRegistro.get(id) ?? id
  const inc = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  // Un movimiento anterior al corte de su billetera ya está dentro del saldo inicial:
  // no debe recontarse. Sin corte configurado, la billetera cuenta todo.
  const antesDelCorte = (wallet: string, fecha?: string | null) => {
    const c = cortes[wallet]
    if (!c) return false
    const t = fecha ? new Date(fecha).getTime() : NaN
    return Number.isFinite(t) && t < c.desde
  }

  // 1) registro_log matcheado en el período (por ts) → órdenes por tienda + ingresos por billetera.
  // Para la billetera importa CUÁNDO ENTRÓ la plata (fechaPago), que es lo que compara el corte.
  const matched = await fetchAllRows((f, t) =>
    sb.from('registro_log')
      .select('store_id, store_name, ts, payment_received_at, source:payment->>source, monto:payment->>monto, amount, fechaPago:payment->>fechaPago')
      .in('action', ['manual_paid', 'auto_paid']).eq('hidden', false)
      .gte('ts', desdeISO).lt('ts', hastaISO)
      .range(f, t))

  const ordenesPorTienda = new Map<string, number>()
  const volTienda = new Map<string, number>()   // volumen ARS emparejado por tienda (base de la comisión)
  const ingBilletera = new Map<string, number>()
  for (const r of matched) {
    const ars = Number(r.monto ?? r.amount) || 0
    if (r.store_id) {
      inc(ordenesPorTienda, r.store_id, 1); inc(volTienda, r.store_id, ars)
      if (r.store_name && !nombreEnRegistro.has(r.store_id)) nombreEnRegistro.set(r.store_id, r.store_name)
    }
    const w = resolveWallet(r.source)
    if (w && !antesDelCorte(w, r.fechaPago || r.payment_received_at || r.ts)) inc(ingBilletera, w, ars)
  }
  // Cola (no emparejados) por fechaPago dentro del período → ingreso a la billetera.
  for (const u of hot.unmatchedPayments ?? []) {
    const p = u.payment
    if (!p?.source) continue
    if (!enRango(p.fechaPago ? new Date(p.fechaPago).getTime() : NaN)) continue
    const w = resolveWallet(p.source)
    if (w && !antesDelCorte(w, p.fechaPago)) inc(ingBilletera, w, Number(p.monto) || 0)
  }

  // 2) balance_movements en el período (por fecha) → cambio neto + comisión por tienda.
  const bmov = await fetchAllRows((f, t) =>
    sb.from('balance_movements').select('store_id, tipo, usdt, fecha')
      .gte('fecha', desdeISO).lt('fecha', hastaISO).range(f, t))
  const brutoUsdt = new Map<string, number>()   // Σ usdt signado (ingresos +, egresos −)
  const ingresoUsdt = new Map<string, number>() // solo ingreso_orden (base de la comisión)
  for (const m of bmov) {
    if (!m.store_id) continue
    const u = Number(m.usdt) || 0
    inc(brutoUsdt, m.store_id, u)
    if (m.tipo === 'ingreso_orden') inc(ingresoUsdt, m.store_id, u)
  }

  // 3) salidas de billetera (wallet_movements) en el período, por billetera (≥ corte).
  const salidasBill = new Map<string, number>()
  const wm = await fetchAllRows((f, t) =>
    sb.from('wallet_movements').select('wallet, ars, fecha').gte('fecha', desdeISO).lt('fecha', hastaISO).range(f, t))
  for (const s of wm) if (s.wallet && !antesDelCorte(s.wallet, s.fecha)) inc(salidasBill, s.wallet, Number(s.ars) || 0)

  // 4) reembolsos ejecutados desde billetera (refunds) en el período, por billetera (≥ corte).
  const reembBill = new Map<string, number>()
  const rf = await fetchAllRows((f, t) =>
    sb.from('refunds').select('wallet, monto, created_at').gte('created_at', desdeISO).lt('created_at', hastaISO).range(f, t))
  // resolveWallet: un reembolso pagado desde "Otras" se guarda como `otras:<nombre>` y
  // tiene que sumar a la billetera "Otras", no aparecer como una billetera aparte.
  for (const r of rf) {
    if (!r.wallet) continue
    const w = resolveWallet(r.wallet)
    if (antesDelCorte(w, r.created_at)) continue
    inc(reembBill, w, Number(r.monto) || 0)
  }

  // 5) reembolsos SOLICITADOS (refund_requests) en el período, cantidad por tienda.
  const reqs = await fetchAllRows((f, t) =>
    sb.from('refund_requests').select('store_id').gte('created_at', desdeISO).lt('created_at', hastaISO).range(f, t))
  const reembReq = new Map<string, number>()
  for (const r of reqs) if (r.store_id) inc(reembReq, r.store_id, 1)

  // ── Armar tiendas ──
  const tiendaIds = new Set<string>([...ordenesPorTienda.keys(), ...brutoUsdt.keys()])
  const tiendas: MetricaTienda[] = [...tiendaIds].map(id => {
    let comisionNetoUsdt: number     // comisión real (grossed-up) sobre los ingresos USDT
    let comisionArsAportada: number  // comisión "aportada" del gráfico: volumen ARS × pct
    if (comisionTiendaVaria(cfg, id)) {
      // Comisión variable: se prorratea por el pct vigente del día de cada ingreso
      // (los ingresos USDT desde balance_movements; el volumen ARS desde el registro).
      const usdtPorPct = new Map<number, number>()
      for (const m of bmov) {
        if (m.store_id !== id || m.tipo !== 'ingreso_orden') continue
        const p = comisionTiendaEnFecha(cfg, id, diaART(m.fecha as string))
        usdtPorPct.set(p, (usdtPorPct.get(p) ?? 0) + (Number(m.usdt) || 0))
      }
      comisionNetoUsdt = 0
      for (const [p, u] of usdtPorPct) comisionNetoUsdt += comisionTiendaSobre(u, p)
      comisionArsAportada = 0
      for (const r of matched) {
        if (r.store_id !== id) continue
        comisionArsAportada += (Number(r.monto ?? r.amount) || 0) * comisionTiendaEnFecha(cfg, id, diaART(r.ts as string)) / 100
      }
    } else {
      // Un solo pct para toda la historia (todas las tiendas de hoy): idéntico al viejo.
      const pct = comisionTiendaActual(cfg, id)
      comisionNetoUsdt = comisionTiendaSobre(ingresoUsdt.get(id) ?? 0, pct)
      comisionArsAportada = (volTienda.get(id) ?? 0) * pct / 100
    }
    return {
      storeId: id,
      storeName: nombreTienda(id),
      netoUsdt: (brutoUsdt.get(id) ?? 0) - comisionNetoUsdt,
      // Volumen BRUTO: la plata que entró por sus órdenes emparejadas, tal cual.
      volumenArs: volTienda.get(id) ?? 0,
      comisionArs: comisionArsAportada,
      ordenes: ordenesPorTienda.get(id) ?? 0,
    }
  }).sort((a, b) => b.netoUsdt - a.netoUsdt)

  // ── Armar billeteras ──
  // Con corte: el saldo inicial (neto previo) se suma UNA vez, si la fecha de corte cae
  // dentro del período. Los movimientos previos al corte no se contaron (ya están adentro).
  const walletSet = new Set<string>([...walletsDeUnidad(), ...ingBilletera.keys(), ...salidasBill.keys(), ...reembBill.keys()])
  const billeteras: MetricaBilletera[] = [...walletSet].map(w => {
    // El saldo inicial se suma si la fecha de corte cae dentro del período. El borde
    // superior es INCLUSIVE: si el corte es justo el instante "hasta" (p. ej. hasta =
    // 12/7 00:00 y el corte es 12/7 00:00), el saldo reconciliado ES el de ese momento.
    const corte = cortes[w]
    const saldoInicial = corte && corte.desde >= desdeMs && corte.desde <= hastaMs ? corte.saldoInicial : 0
    // "Solo saldo inicial": la billetera ignora toda su actividad, igual que en su panel.
    if (corte?.soloInicial) return { wallet: w, netoArs: saldoInicial }
    const ingresos = ingBilletera.get(w) ?? 0
    const comision = ingresos * comisionBilletera(cfg, w) / 100
    return { wallet: w, netoArs: saldoInicial + ingresos - comision - (reembBill.get(w) ?? 0) - (salidasBill.get(w) ?? 0) }
  })
    .filter(b => walletsDeUnidad().includes(b.wallet) || b.netoArs !== 0)
    .sort((a, b) => b.netoArs - a.netoArs)

  const reembolsosPorTienda: MetricaReembolsos[] = [...reembReq.entries()]
    .map(([id, c]) => ({ storeId: id, storeName: nombreTienda(id), cantidad: c }))
    .sort((a, b) => b.cantidad - a.cantidad)

  const saldoTiendasUsdt = tiendas.reduce((s, t) => s + t.netoUsdt, 0)
  return {
    desde: desdeISO,
    hasta: hastaISO,
    ordenesTotal: [...ordenesPorTienda.values()].reduce((s, n) => s + n, 0),
    volumenTotalArs: [...volTienda.values()].reduce((s, n) => s + n, 0),
    saldoTiendasUsdt,
    saldoTiendasArs: cotizacion != null ? saldoTiendasUsdt * cotizacion : null,
    cotizacion: cotizacion ?? null,
    saldoBilleterasArs: billeteras.reduce((s, b) => s + b.netoArs, 0),
    reembolsosTotal: [...reembReq.values()].reduce((s, n) => s + n, 0),
    tiendas,
    billeteras,
    reembolsosPorTienda,
  }
}
