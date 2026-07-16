'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import AnimatedNumber, { NumberSkeleton } from '@/components/AnimatedNumber'
import SelectorDia from '@/components/SelectorDia'
import BilleteraRetiros from './BilleteraRetiros'
import EditarMovimientoModal, { type MovimientoEditable } from '@/components/EditarMovimientoModal'
import type { Toast } from './FinanzasApp'

interface Pago {
  fecha: string
  titular: string
  monto: number
  comision: number
  estado: 'emparejado' | 'en_cola' | 'reembolsado'
  detalle?: string   // billetera "Otras": nombre libre del pago
}
const ESTADO_LABEL: Record<Pago['estado'], string> = { emparejado: 'Emparejado', en_cola: 'En cola', reembolsado: 'Reembolsado' }
const ESTADO_STYLE: Record<Pago['estado'], React.CSSProperties> = {
  emparejado: { background: 'rgba(0,255,136,0.1)', color: '#00ff88' },
  en_cola: { background: 'rgba(245,158,11,0.1)', color: '#fbbf24' },
  reembolsado: { background: 'rgba(167,139,250,0.12)', color: '#a78bfa' },
}
interface MovimientoDia {
  clase: 'retiro' | 'reembolso' | 'ajuste'
  fecha: string
  concepto: string
  moneda?: 'ARS' | 'USD' | 'USDT'
  montoOrigen?: number
  cotizacion?: number | null
  ars: number
  refundId?: number   // reembolso con comprobante → id para descargarlo
  salidaId?: number   // id del wallet_movement (retiro/ajuste) → editable
  reembolsoId?: number // id del refund → editable
  tasaEdit?: number | null // cotización para prellenar la edición
}
interface Detalle {
  wallet: string
  totalArs: number
  cantidad: number
  comisionPct: number
  dias: string[]
  totalDia?: number
  cantidadDia?: number
  comisionDia?: number
  salidasDiaArs?: number
  reembolsosDiaArs?: number
  ajustesDiaArs?: number
  saldoDia?: number
  movimientosDia?: MovimientoDia[]
  pagos: Pago[]
}

const fmtPct = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const fmtArs = (n: number) => ARS.format(n)

// Columnas ordenables del extracto del día.
type SortKey = 'fecha' | 'titular' | 'detalle' | 'monto' | 'comision' | 'estado'

// Hoy en horario Argentina (UTC-3) como 'YYYY-MM-DD'
function hoyART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Vista de una billetera: saldo histórico (sin corte, a diferencia de las tiendas)
// + extracto dividido por día, y la pestaña "Retirar saldo".
export default function BilleteraTab({ wallet, notify, refreshKey = 0 }: { wallet: string; notify: (msg: string, type?: Toast['type']) => void; refreshKey?: number }) {
  const [data, setData] = useState<Detalle | null>(null)
  const [fecha, setFecha] = useState(hoyART())
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'balance' | 'pagos'>('balance')
  // Ordenamiento del extracto: se clickea la cabecera para elegir columna y alternar
  // asc/desc. Default: por fecha ascendente (igual que devuelve el backend).
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editandoMov, setEditandoMov] = useState<MovimientoEditable | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/finanzas/billetera?wallet=${encodeURIComponent(wallet)}&fecha=${fecha}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setData(await res.json())
    } catch (e) {
      notify(`No se pudo cargar la billetera: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [wallet, fecha, notify])

  // Carga inicial + al cambiar de día + refresco cada 60s (respaldo)
  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [fetchData])

  // Tiempo real: al marcar/emparejar un pago desde el app de órdenes, refrescar para
  // que el pago cambie de estado (en cola → emparejado) y el saldo se actualice.
  useEffect(() => { if (refreshKey > 0) fetchData() }, [refreshKey, fetchData])

  // Si el día abierto no tuvo movimientos (p. ej. hoy todavía no entró nada), saltar
  // al último que sí los tuvo: el calendario ya no deja elegirlo a mano.
  const dias = data?.dias
  useEffect(() => {
    if (dias?.length && !dias.includes(fecha)) setFecha(dias[dias.length - 1])
  }, [dias, fecha])

  const tabs: { key: 'balance' | 'pagos'; label: string }[] = [
    { key: 'balance', label: 'Balance de Saldo' },
    { key: 'pagos', label: 'Retirar saldo' },
  ]

  // Cabeceras del extracto: clickear una columna la ordena; volver a clickearla
  // invierte el sentido. Las de texto arrancan ascendente; las numéricas, descendente.
  // "Otras" agrupa pagos con distinto nombre libre: se muestra ese nombre en su propia
  // columna "Billetera", ordenable alfabéticamente (útil para filtrar por nombre).
  const esOtras = wallet === 'Otras'
  const columnas: { key: SortKey; label: string }[] = [
    { key: 'fecha', label: 'Fecha y hora del pago' },
    { key: 'titular', label: 'Titular' },
    ...(esOtras ? [{ key: 'detalle' as SortKey, label: 'Billetera' }] : []),
    { key: 'monto', label: 'Monto (ARS)' },
    { key: 'comision', label: `Comisión (${fmtPct(data?.comisionPct ?? 0)}%)` },
    { key: 'estado', label: 'Estado' },
  ]
  function ordenarPor(key: SortKey) {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'monto' || key === 'comision' ? 'desc' : 'asc')
  }

  // Extracto ordenado según la columna elegida (ordena solo los pagos ya cargados).
  const pagosOrdenados = useMemo(() => {
    const arr = [...(data?.pagos ?? [])]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'fecha':   cmp = (new Date(a.fecha).getTime() || 0) - (new Date(b.fecha).getTime() || 0); break
        case 'titular': cmp = (a.titular || '').localeCompare(b.titular || '', 'es'); break
        case 'detalle': cmp = (a.detalle || '').localeCompare(b.detalle || '', 'es'); break
        case 'monto':   cmp = a.monto - b.monto; break
        case 'comision': cmp = a.comision - b.comision; break
        case 'estado':  cmp = a.estado.localeCompare(b.estado, 'es'); break
      }
      return cmp !== 0 ? cmp * dir : 0
    })
    return arr
  }, [data?.pagos, sortKey, sortDir])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#00d4ff' }}>Billetera {wallet}</h2>
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Saldo histórico completo. El día agrupa por emparejamiento: un pago en cola figura en su día de ingreso y, al emparejarse, pasa al día del match conservando su fecha y hora originales. Los marcados “No es de tiendas” no cuentan.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => {
          const activo = vista === t.key
          return (
            <button
              key={t.key}
              onClick={() => setVista(t.key)}
              className="rounded-xl px-4 py-2 text-xs font-semibold transition-all"
              style={{
                background: activo ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activo ? 'rgba(0,212,255,0.4)' : 'rgba(148,163,184,0.12)'}`,
                color: activo ? '#00d4ff' : 'rgba(148,163,184,0.75)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {vista === 'pagos' && <BilleteraRetiros wallet={wallet} notify={notify} onRetiro={fetchData} />}

      {vista === 'balance' && <>

      {/* Tarjeta de total acumulado (no cambia con el día) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative rounded-2xl p-5 sm:p-6 overflow-hidden max-w-sm"
        style={{ background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)', border: '1px solid #00ff8833', boxShadow: '0 0 20px #00ff8814' }}
      >
        <div className="absolute top-0 right-0 w-28 h-28 opacity-10 rounded-full pointer-events-none"
          style={{ background: '#00ff88', filter: 'blur(32px)', transform: 'translate(30%, -30%)' }} />
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>Saldo</p>
        <p className="text-3xl sm:text-4xl font-black" style={{ color: '#00ff88', textShadow: '0 0 20px #00ff8860' }}>
          {loading && !data
            ? <NumberSkeleton width={200} height={40} />
            : <AnimatedNumber value={data?.totalArs ?? 0} format={fmtArs} />}
        </p>
        <p className="text-xs mt-2" style={{ color: 'rgba(148,163,184,0.5)' }}>
          {data?.cantidad ?? 0} pago{(data?.cantidad ?? 0) === 1 ? '' : 's'} · comisión, reembolsos y retiros ya descontados
        </p>
      </motion.div>

      {/* Selector de día: solo deja elegir días con movimiento */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.7)' }}>Día</label>
          <SelectorDia value={fecha} dias={data?.dias ?? []} onChange={setFecha} disabled={!data?.dias?.length} />
        </div>
        <p className="text-[11px] leading-relaxed max-w-md" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Cada pago figura en el día en que <span style={{ color: 'rgba(148,163,184,0.75)' }}>ingresó a la billetera</span>, sin importar cuándo se emparejó con una orden.
        </p>
      </div>

      {/* Balance del día: ingresos − comisión − retiros − reembolsos */}
      <motion.div
        key={fecha}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="rounded-2xl p-4 max-w-sm"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.18)' }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(0,212,255,0.7)' }}>
          Saldo del día
        </p>
        <p className="text-2xl font-black" style={{ color: (data?.saldoDia ?? 0) < 0 ? '#f87171' : '#00ff88' }}>
          {loading && !data ? <NumberSkeleton width={140} height={28} /> : <AnimatedNumber value={data?.saldoDia ?? 0} format={fmtArs} />}
        </p>
        <div className="mt-3 space-y-1 text-xs">
          {(data?.ajustesDiaArs ?? 0) > 0 && (
            <Linea label="Saldo inicial" valor={data?.ajustesDiaArs ?? 0} color="#00ff88" signo="+" />
          )}
          <Linea label={`Ingresos (${data?.cantidadDia ?? 0} pago${(data?.cantidadDia ?? 0) === 1 ? '' : 's'})`}
            valor={data?.totalDia ?? 0} color="#00ff88" signo="+" />
          {(data?.comisionDia ?? 0) > 0 && (
            <Linea label={`Comisión ${fmtPct(data?.comisionPct ?? 0)}%`} valor={data?.comisionDia ?? 0} color="#f87171" signo="−" />
          )}
          {(data?.salidasDiaArs ?? 0) > 0 && (
            <Linea label="Retiros y transferencias" valor={data?.salidasDiaArs ?? 0} color="#f87171" signo="−" />
          )}
          {(data?.reembolsosDiaArs ?? 0) > 0 && (
            <Linea label="Reembolsos" valor={data?.reembolsosDiaArs ?? 0} color="#f87171" signo="−" />
          )}
        </div>
      </motion.div>

      {/* Extracto del día */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '640px' }}>
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
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={esOtras ? 6 : 5} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</td></tr>
              ) : !data || data.pagos.length === 0 ? (
                <tr><td colSpan={esOtras ? 6 : 5} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin pagos este día</td></tr>
              ) : (
                pagosOrdenados.map((p, i) => (
                  <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                    style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(p.fecha)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>
                      {p.titular || '—'}
                      {!esOtras && p.detalle && <span className="ml-1.5 text-[11px]" style={{ color: 'rgba(167,139,250,0.9)' }}>· {p.detalle}</span>}
                    </td>
                    {esOtras && (
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: 'rgba(167,139,250,0.95)' }}>{p.detalle || '—'}</td>
                    )}
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#00ff88' }}>{ARS.format(p.monto)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#f87171' }}>−{ARS.format(p.comision)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={ESTADO_STYLE[p.estado]}>
                        {ESTADO_LABEL[p.estado]}
                      </span>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && (data.cantidadDia ?? 0) > data.pagos.length && (
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Mostrando los {data.pagos.length} pagos más antiguos de {data.cantidadDia} del día.
        </p>
      )}

      {/* Retiros y reembolsos del día: van a continuación de los pagos, con sus
          propias columnas, porque no son ingresos sino plata que sale. */}
      {data && (data.movimientosDia?.length ?? 0) > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(248,113,113,0.15)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '640px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(248,113,113,0.15)' }}>
                  {['Fecha y hora', 'Concepto', 'Monto original', 'Cotización', 'Monto (ARS)', 'Tipo', 'Comprobante'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                      style={{ color: 'rgba(248,113,113,0.7)' }}>{h}</th>
                  ))}
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.movimientosDia!.map((m, i) => {
                  // En ARS no hay conversión: monto original y cotización no aportan nada.
                  const convertido = m.cotizacion != null && m.moneda !== 'ARS'
                  return (
                    <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
                      style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(m.fecha)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{m.concepto}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium"
                        style={{ color: convertido ? '#00d4ff' : 'rgba(148,163,184,0.35)' }}>
                        {convertido ? `${(m.montoOrigen ?? 0).toLocaleString('es-AR')} ${m.moneda}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: convertido ? 'rgba(226,232,240,0.7)' : 'rgba(148,163,184,0.35)' }}>
                        {convertido ? ARS.format(m.cotizacion!) : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: m.clase === 'ajuste' ? '#00ff88' : '#f87171' }}>
                        {m.clase === 'ajuste' ? '+' : '−'}{ARS.format(m.ars)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={m.clase === 'ajuste'
                            ? { background: 'rgba(0,255,136,0.1)', color: '#00ff88' }
                            : { background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                          {m.clase === 'ajuste' ? 'Ajuste' : m.clase === 'retiro' ? 'Retiro' : 'Reembolso'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {m.refundId != null ? (
                          <a href={`/api/tienda/comprobante-reembolso?id=${m.refundId}`}
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
                      <td className="px-3 py-2.5 whitespace-nowrap text-right">
                        {(m.reembolsoId != null || m.salidaId != null) && (
                          <button onClick={() => setEditandoMov(
                            m.reembolsoId != null
                              ? { fuente: 'refund', id: m.reembolsoId, fechaISO: m.fecha, concepto: m.concepto, montoArs: m.ars, tasa: m.tasaEdit ?? null, puedeMontoTasa: true, tasaLabel: 'ARS/USDT' }
                              : { fuente: 'wallet', id: m.salidaId!, fechaISO: m.fecha, concepto: m.concepto, montoArs: m.ars, tasa: m.tasaEdit ?? null, puedeMontoTasa: true, tasaLabel: m.moneda && m.moneda !== 'ARS' ? `ARS por 1 ${m.moneda}` : undefined }
                          )}
                            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
                            style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}>
                            Editar
                          </button>
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
      </>}
      {editandoMov && (
        <EditarMovimientoModal mov={editandoMov} notify={notify}
          onCerrar={() => setEditandoMov(null)} onGuardado={fetchData} />
      )}
    </div>
  )
}

// Una línea del desglose del saldo del día.
function Linea({ label, valor, color, signo }: { label: string; valor: number; color: string; signo: '+' | '−' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: 'rgba(148,163,184,0.7)' }}>{label}</span>
      <span className="font-semibold whitespace-nowrap" style={{ color }}>{signo}{ARS.format(valor)}</span>
    </div>
  )
}
