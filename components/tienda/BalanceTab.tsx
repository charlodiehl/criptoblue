'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import AnimatedNumber, { NumberSkeleton } from '@/components/AnimatedNumber'
import SelectorDia from '@/components/SelectorDia'
import EditarRegistroModal, { type FilaEditable } from './EditarRegistroModal'
import type { Toast } from './TiendaPortal'

interface Props {
  storeId: string
  qs: string
  notify: (msg: string, type?: Toast['type']) => void
  // Solo el admin puede corregir el registro (vista espejo desde /finanzas).
  admin?: boolean
  // Señal de refresco en tiempo real: al marcar una orden, re-consulta el saldo.
  refreshKey?: number
}

interface Movimiento {
  id: number
  tipo: 'egreso_transferencia' | 'reembolso' | 'ajuste'
  fecha: string
  ars: number
  usdt: number | null
  descripcion: string | null
  // Detalle de la transferencia: monto que ingresó el admin (en su moneda) y comprobante.
  montoOriginal: number | null
  monedaOriginal: string | null
  tieneComprobante: boolean
  refTransferId: number | null
}
interface BalanceDia {
  ingresosArs: number
  ingresosUsdt: number
  cantidadIngresos: number
  comisionArs: number
  comisionUsdt: number
  comisionPct: number
  transferenciasUsdt: number
  reembolsosArs: number
  reembolsosUsdt: number
  ajustesUsdt: number
  saldoUsdt: number
  movimientos: Movimiento[]
}
interface Balance {
  ars: number; usdt: number; pendientes: number
  comisionArs: number; comisionUsdt: number; comisionPct: number
  dias: string[]
  dia?: BalanceDia
}
interface Row {
  registroId: number
  fecha: string
  monto: number
  comision: number
  cuit: string
  nombre: string
  orderNumber: string
  billetera: string
  usdtRate: number | null
  usdt: number | null
}

// Hoy en horario Argentina (UTC-3) como 'YYYY-MM-DD'
function hoyART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}


const fmtUsdt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

// Columnas ordenables del registro de la tienda.
type SortKey = 'fecha' | 'monto' | 'comision' | 'usdtRate' | 'usdt' | 'cuit' | 'nombre' | 'orderNumber'

export default function BalanceTab({ storeId, qs, notify, admin = false, refreshKey = 0 }: Props) {
  const [editando, setEditando] = useState<FilaEditable | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [fecha, setFecha] = useState(hoyART())
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  // Cotización para mostrar el saldo también en pesos: precio de venta Binance P2P
  // +0%. Se refresca cada hora (no en cada refresco de saldo).
  const [cotizacion, setCotizacion] = useState<number | null>(null)
  // Ordenamiento del registro: se clickea la cabecera para elegir columna y alternar
  // asc/desc. Default: por fecha descendente (más nuevos arriba, igual que el backend).
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const searching = debouncedSearch.length > 0

  // Cabeceras clickeables del registro. Volver a clickear la columna activa invierte
  // el sentido. Texto (CUIT, nombre, orden) arranca ascendente; el resto descendente.
  const columnas: { key: SortKey; label: string }[] = [
    { key: 'fecha', label: 'Fecha y hora' },
    { key: 'monto', label: 'Monto (ARS)' },
    { key: 'comision', label: `Comisión (${fmtPct(balance?.comisionPct ?? 0)}%)` },
    { key: 'usdtRate', label: 'Cotización USDT' },
    { key: 'usdt', label: 'Equivalente USDT' },
    { key: 'cuit', label: 'CUIT/CUIL/DNI' },
    { key: 'nombre', label: 'Nombre y apellido' },
    { key: 'orderNumber', label: 'N° orden' },
  ]
  function ordenarPor(key: SortKey) {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'cuit' || key === 'nombre' || key === 'orderNumber' ? 'asc' : 'desc')
  }

  // Registro ordenado según la columna elegida (ordena las filas ya cargadas del día
  // o de la búsqueda). Los valores nulos (cotización/USDT pendientes) van al final.
  const rowsOrdenados = useMemo(() => {
    const num = (v: number | null | undefined) => (v == null ? -Infinity : v)
    const arr = [...rows]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'fecha':       cmp = (new Date(a.fecha).getTime() || 0) - (new Date(b.fecha).getTime() || 0); break
        case 'monto':       cmp = a.monto - b.monto; break
        case 'comision':    cmp = a.comision - b.comision; break
        case 'usdtRate':    cmp = num(a.usdtRate) - num(b.usdtRate); break
        case 'usdt':        cmp = num(a.usdt) - num(b.usdt); break
        case 'cuit':        cmp = (a.cuit || '').localeCompare(b.cuit || '', 'es', { numeric: true }); break
        case 'nombre':      cmp = (a.nombre || '').localeCompare(b.nombre || '', 'es'); break
        case 'orderNumber': cmp = (a.orderNumber || '').localeCompare(b.orderNumber || '', 'es', { numeric: true }); break
      }
      return cmp !== 0 ? cmp * dir : 0
    })
    return arr
  }, [rows, sortKey, sortDir])
  // ARS = USDT × cotización actual. null mientras no haya cotización (API caída).
  const aArs = (usdt: number | null | undefined): number | null =>
    cotizacion == null || usdt == null ? null : usdt * cotizacion

  // Trae el saldo total y, en la misma llamada, el balance del día seleccionado.
  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true)
    try {
      const sep = qs ? '&' : '?'
      const res = await fetch(`/api/tienda/balance${qs}${sep}fecha=${fecha}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setBalance(await res.json())
    } catch (e) {
      notify(`No se pudo cargar el balance: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingBalance(false)
    }
  }, [qs, notify, fecha])

  // Con búsqueda → busca en todo el registro; sin búsqueda → órdenes del día.
  const fetchRows = useCallback(async () => {
    setLoadingRows(true)
    try {
      const sep = qs ? '&' : '?'
      const url = debouncedSearch
        ? `/api/tienda/registro${qs}${sep}q=${encodeURIComponent(debouncedSearch)}`
        : `/api/tienda/registro${qs}${sep}fecha=${fecha}`
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      const data = await res.json()
      setRows(data.rows || [])
    } catch (e) {
      notify(`No se pudieron cargar las órdenes: ${e instanceof Error ? e.message : e}`, 'error')
      setRows([])
    } finally {
      setLoadingRows(false)
    }
  }, [qs, notify, fecha, debouncedSearch])

  // Debounce del buscador (300ms) para no pegarle al server en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Carga inicial + refresco cada 60s (respaldo por si Realtime se desconecta)
  useEffect(() => {
    fetchBalance()
    const iv = setInterval(fetchBalance, 60_000)
    return () => clearInterval(iv)
  }, [fetchBalance])
  useEffect(() => { fetchRows() }, [fetchRows])

  // Tiempo real: al marcar una orden desde el app de órdenes, re-consultar saldo + tabla.
  useEffect(() => { if (refreshKey > 0) { fetchBalance(); fetchRows() } }, [refreshKey, fetchBalance, fetchRows])

  // Cotización para el saldo en pesos: carga inicial + refresco cada 1 hora. Si la
  // API falla se conserva la última (no se pisa con null) para no perder el peso mostrado.
  useEffect(() => {
    let vivo = true
    const traer = async () => {
      try {
        const res = await fetch(`/api/tienda/cotizacion${qs}`)
        if (!res.ok) return
        const data = await res.json()
        if (vivo && Number(data.rate) > 0) setCotizacion(Number(data.rate))
      } catch { /* se reintenta en la próxima hora */ }
    }
    traer()
    const iv = setInterval(traer, 60 * 60 * 1000)
    return () => { vivo = false; clearInterval(iv) }
  }, [qs])

  // Si el día abierto no tuvo movimientos (hoy todavía no entró nada), saltar al
  // último que sí los tuvo: el calendario ya no deja elegirlo a mano.
  const dias = balance?.dias
  useEffect(() => {
    if (dias?.length && !dias.includes(fecha)) setFecha(dias[dias.length - 1])
  }, [dias, fecha])

  return (
    <div className="space-y-5">
      {/* Tarjeta de balance global — SOLO USDT (NETO, con la comisión ya descontada).
          El desglose no va acá: vive en la tarjeta del día, más abajo. */}
      <div className="grid grid-cols-1 gap-3 max-w-sm">
        <BalanceCard label="Saldo en USDT" value={balance?.usdt ?? 0} format={fmtUsdt} suffix="USDT" color="#00d4ff" delay={0} loading={loadingBalance}
          arsValue={aArs(balance?.usdt ?? 0)} cotizacion={cotizacion} />
      </div>

      {balance && balance.pendientes > 0 && (
        <div className="text-xs px-4 py-2.5 rounded-xl flex items-center gap-2"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
          <span>⚠️</span>
          <span>{balance.pendientes} movimiento{balance.pendientes === 1 ? '' : 's'} sin cotización — el saldo en USDT es parcial hasta que se complete la cotización.</span>
        </div>
      )}

      {/* Buscador de órdenes (en todo el registro desde el corte) */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'rgba(148,163,184,0.6)' }}>🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar orden por N° de orden, nombre, CUIT o monto…"
          className="w-full rounded-xl py-2.5 pl-9 pr-9 text-sm outline-none"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.25)', color: 'rgba(226,232,240,0.92)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none"
            style={{ color: 'rgba(148,163,184,0.7)', cursor: 'pointer' }}>×</button>
        )}
      </div>

      {/* Selector de día: solo deja elegir días con movimiento. Se desactiva al buscar. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: searching ? 'rgba(148,163,184,0.4)' : 'rgba(0,212,255,0.7)' }}>Día</label>
          <SelectorDia value={fecha} dias={balance?.dias ?? []} onChange={setFecha} disabled={searching || !balance?.dias?.length} />
          {searching && <span className="text-xs" style={{ color: 'rgba(0,212,255,0.7)' }}>Mostrando resultados de búsqueda en todo el registro</span>}
        </div>
        {!searching && (
          <p className="text-[11px] leading-relaxed max-w-lg" style={{ color: 'rgba(148,163,184,0.5)' }}>
            El día reúne las <span style={{ color: 'rgba(148,163,184,0.75)' }}>órdenes que se emparejaron</span> en esa fecha —aunque el pago haya entrado otro día— junto con los <span style={{ color: 'rgba(148,163,184,0.75)' }}>retiros, reembolsos y ajustes</span> registrados ese día.
          </p>
        )}
      </div>

      {/* Balance del día: ingresos − comisión − transferencias − reembolsos.
          Se oculta durante una búsqueda, porque entonces la tabla no es de un día. */}
      {!searching && (
        <motion.div
          key={fecha}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="rounded-2xl p-4 max-w-sm"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.18)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(0,212,255,0.7)' }}>
            Saldo del día
          </p>
          <p className="text-2xl font-black" style={{ color: (balance?.dia?.saldoUsdt ?? 0) < 0 ? '#f87171' : '#00d4ff' }}>
            {loadingBalance && !balance
              ? <NumberSkeleton width={140} height={28} />
              : <><AnimatedNumber value={balance?.dia?.saldoUsdt ?? 0} format={fmtUsdt} /><span className="text-sm font-bold ml-2" style={{ opacity: 0.7 }}>USDT</span></>}
          </p>
          {!(loadingBalance && !balance) && aArs(balance?.dia?.saldoUsdt ?? 0) != null && (
            <p className="text-sm font-bold mt-0.5" style={{ color: 'rgba(226,232,240,0.85)' }}>
              ≈ {ARS.format(aArs(balance?.dia?.saldoUsdt ?? 0)!)}
            </p>
          )}
          <div className="mt-3 space-y-1 text-xs">
            <Linea
              label={`Ingresos (${balance?.dia?.cantidadIngresos ?? 0} orden${(balance?.dia?.cantidadIngresos ?? 0) === 1 ? '' : 'es'})`}
              valor={fmtUsdt(balance?.dia?.ingresosUsdt ?? 0)}
              color="#00ff88" signo="+" />
            {(balance?.dia?.comisionUsdt ?? 0) > 0 && (
              <Linea label={`Comisión ${fmtPct(balance?.dia?.comisionPct ?? 0)}%`}
                valor={fmtUsdt(balance!.dia!.comisionUsdt)} color="#f87171" signo="−" />
            )}
            {(balance?.dia?.transferenciasUsdt ?? 0) > 0 && (
              <Linea label="Transferencias" valor={fmtUsdt(balance!.dia!.transferenciasUsdt)} color="#f87171" signo="−" />
            )}
            {(balance?.dia?.reembolsosUsdt ?? 0) > 0 && (
              <Linea label="Reembolsos" valor={fmtUsdt(balance!.dia!.reembolsosUsdt)} color="#f87171" signo="−" />
            )}
            {(balance?.dia?.ajustesUsdt ?? 0) !== 0 && (
              <Linea label="Ajustes" valor={fmtUsdt(Math.abs(balance!.dia!.ajustesUsdt))}
                color={balance!.dia!.ajustesUsdt > 0 ? '#00ff88' : '#f87171'}
                signo={balance!.dia!.ajustesUsdt > 0 ? '+' : '−'} />
            )}
          </div>
        </motion.div>
      )}

      {/* Tabla de órdenes del día */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                {columnas.map(col => {
                  const activa = sortKey === col.key
                  return (
                    <th key={col.key} onClick={() => ordenarPor(col.key)} title="Ordenar por esta columna"
                      className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap select-none transition-colors"
                      style={{ color: activa ? 'rgba(0,212,255,0.9)' : 'rgba(148,163,184,0.7)', cursor: 'pointer' }}>
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <span style={{ fontSize: '8px', opacity: activa ? 1 : 0.3 }}>
                          {activa ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </span>
                    </th>
                  )
                })}
                {admin && <th className="px-3 py-3" style={{ color: 'rgba(148,163,184,0.7)' }} />}
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr><td colSpan={admin ? 9 : 8} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={admin ? 9 : 8} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  {searching ? `Sin resultados para "${debouncedSearch}"` : 'Sin órdenes acreditadas este día'}
                </td></tr>
              ) : (
                rowsOrdenados.map((r, i) => (
                  <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                    style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(r.fecha)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#00ff88' }}>{ARS.format(r.monto)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#f87171' }}>−{ARS.format(r.comision)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: r.usdtRate == null ? 'rgba(245,158,11,0.9)' : 'rgba(226,232,240,0.7)' }}>
                      {r.usdtRate == null ? 'Pendiente' : ARS.format(r.usdtRate)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: r.usdt == null ? 'rgba(148,163,184,0.4)' : '#00d4ff' }}>
                      {r.usdt == null ? '—' : fmtUsdt(r.usdt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.7)' }}>{r.cuit || '—'}</td>
                    <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{r.nombre || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.7)' }}>{r.orderNumber ? `#${r.orderNumber}` : '—'}</td>
                    {admin && (
                      <td className="px-3 py-2.5 whitespace-nowrap text-right">
                        <button
                          onClick={() => setEditando({ registroId: r.registroId, monto: r.monto, cuit: r.cuit, nombre: r.nombre, orderNumber: r.orderNumber, usdtRate: r.usdtRate })}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
                          style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}>
                          Editar
                        </button>
                      </td>
                    )}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transferencias, reembolsos y ajustes del día: a continuación de las órdenes,
          con sus propias columnas, porque no son ingresos sino plata que sale. */}
      {!searching && (balance?.dia?.movimientos.length ?? 0) > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(248,113,113,0.15)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '640px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(248,113,113,0.15)' }}>
                  {['Fecha y hora', 'Concepto', 'Monto (ARS)', 'Monto (USDT)', 'Tipo', 'Comprobante'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                      style={{ color: 'rgba(248,113,113,0.7)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {balance!.dia!.movimientos.map((m, i) => {
                  const positivo = (m.usdt ?? 0) > 0
                  // Monto en ARS a mostrar: el que ingresó el admin si la transferencia
                  // fue en pesos; si no, el ars propio del movimiento (reembolso/ajuste).
                  const esArs = m.monedaOriginal === 'ARS' || m.monedaOriginal === 'ARS_BILLETE'
                  const montoArs = esArs && m.montoOriginal != null ? m.montoOriginal
                    : (m.ars !== 0 ? Math.abs(m.ars) : null)
                  return (
                    <motion.tr key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
                      style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(m.fecha)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{m.descripcion || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: montoArs == null ? 'rgba(148,163,184,0.4)' : '#f87171' }}>
                        {montoArs == null ? '—' : `−${ARS.format(montoArs)}`}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: positivo ? '#00ff88' : '#f87171' }}>
                        {m.usdt == null ? '—' : `${positivo ? '+' : '−'}${fmtUsdt(Math.abs(m.usdt))}`}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                          {TIPO_LABEL[m.tipo] ?? m.tipo}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {m.tieneComprobante && m.refTransferId != null ? (
                          <a href={`/api/tienda/comprobante?id=${m.refTransferId}${qs ? `&${qs.slice(1)}` : ''}`}
                            target="_blank" rel="noopener noreferrer" title="Descargar comprobante"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 transition-all"
                            style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                            </svg>
                            Descargar
                          </a>
                        ) : (
                          <span style={{ color: 'rgba(148,163,184,0.4)' }}>—</span>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editando && (
        <EditarRegistroModal
          fila={editando}
          storeId={storeId}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { fetchRows(); fetchBalance() }}
          notify={notify}
        />
      )}
    </div>
  )
}

const TIPO_LABEL: Record<string, string> = {
  egreso_transferencia: 'Transferencia',
  reembolso: 'Reembolso',
  ajuste: 'Ajuste',
}

// Una línea del desglose del saldo del día. Todo en USDT: el saldo de tienda vive
// en esa moneda y mostrar el equivalente en ARS al lado sólo agregaba ruido. La
// unidad se escribe acá una vez, y no en cada llamada.
function Linea({ label, valor, color, signo }: {
  label: string; valor: string; color: string; signo: '+' | '−'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: 'rgba(148,163,184,0.7)' }}>{label}</span>
      <span className="font-semibold whitespace-nowrap" style={{ color }}>
        {signo}{valor}<span className="ml-1" style={{ opacity: 0.6 }}>USDT</span>
      </span>
    </div>
  )
}

function BalanceCard({ label, value, format, suffix, color, delay, loading, arsValue, cotizacion }: {
  label: string; value: number; format: (n: number) => string; suffix?: string; color: string; delay: number; loading: boolean
  arsValue?: number | null; cotizacion?: number | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      className="relative rounded-2xl p-6 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)', border: `1px solid ${color}33`, boxShadow: `0 0 20px ${color}14` }}
    >
      <div className="absolute top-0 right-0 w-28 h-28 opacity-10 rounded-full pointer-events-none"
        style={{ background: color, filter: 'blur(32px)', transform: 'translate(30%, -30%)' }} />
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>{label}</p>
      <p className="text-4xl font-black" style={{ color, textShadow: `0 0 20px ${color}60` }}>
        {loading
          ? <NumberSkeleton width={170} height={40} />
          : <AnimatedNumber value={value} format={format} />}
        {!loading && suffix && <span className="text-lg font-bold ml-2" style={{ opacity: 0.7 }}>{suffix}</span>}
      </p>
      {!loading && arsValue != null && (
        <p className="mt-1 text-lg font-bold" style={{ color: 'rgba(226,232,240,0.9)' }}>
          ≈ {ARS.format(arsValue)}
          {cotizacion != null && (
            <span className="block text-[11px] font-medium mt-1" style={{ color: 'rgba(148,163,184,0.5)' }}>
              a {ARS.format(cotizacion)}/USDT · valor estimado en pesos, se actualiza cada 1 hora
            </span>
          )}
        </p>
      )}
    </motion.div>
  )
}
