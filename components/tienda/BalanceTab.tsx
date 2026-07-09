'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import AnimatedNumber, { NumberSkeleton } from '@/components/AnimatedNumber'
import type { Toast } from './TiendaPortal'

interface Props {
  storeId: string
  qs: string
  notify: (msg: string, type?: Toast['type']) => void
}

interface Balance { ars: number; usdt: number; pendientes: number; comisionArs: number; comisionUsdt: number; comisionPct: number }
interface Row {
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

// Fecha de corte del balance (debe coincidir con BALANCE_CUTOFF de lib/config.ts):
// el saldo y esta tabla solo cuentan órdenes desde acá. El server es el que manda.
const CUTOFF_DATE = '2026-07-08'

const fmtUsdt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const fmtArs = (n: number) => ARS.format(n)

export default function BalanceTab({ qs, notify }: Props) {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [fecha, setFecha] = useState(hoyART())
  const [rows, setRows] = useState<Row[]>([])
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)

  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true)
    try {
      const res = await fetch(`/api/tienda/balance${qs}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setBalance(await res.json())
    } catch (e) {
      notify(`No se pudo cargar el balance: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingBalance(false)
    }
  }, [qs, notify])

  const fetchRows = useCallback(async (dia: string) => {
    setLoadingRows(true)
    try {
      const sep = qs ? '&' : '?'
      const res = await fetch(`/api/tienda/registro${qs}${sep}fecha=${dia}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      const data = await res.json()
      setRows(data.rows || [])
    } catch (e) {
      notify(`No se pudieron cargar las órdenes: ${e instanceof Error ? e.message : e}`, 'error')
      setRows([])
    } finally {
      setLoadingRows(false)
    }
  }, [qs, notify])

  // Carga inicial + refresco cada 60s (el balance cambia al emparejarse pagos o pagar transferencias)
  useEffect(() => {
    fetchBalance()
    const iv = setInterval(fetchBalance, 60_000)
    return () => clearInterval(iv)
  }, [fetchBalance])
  useEffect(() => { fetchRows(fecha) }, [fecha, fetchRows])

  return (
    <div className="space-y-5">
      {/* Tarjeta de balance global (NETO, con la comisión ya descontada) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BalanceCard label="Saldo en USDT" value={balance?.usdt ?? 0} format={fmtUsdt} suffix="USDT" color="#00d4ff" delay={0} loading={loadingBalance}
          comisionValue={balance?.comisionUsdt} comisionFormat={fmtUsdt} comisionPct={balance?.comisionPct} comisionSuffix="USDT" />
        <BalanceCard label="Saldo en ARS" value={balance?.ars ?? 0} format={fmtArs} color="#00ff88" delay={0.06} loading={loadingBalance}
          comisionValue={balance?.comisionArs} comisionFormat={fmtArs} comisionPct={balance?.comisionPct} />
      </div>

      {balance && balance.pendientes > 0 && (
        <div className="text-xs px-4 py-2.5 rounded-xl flex items-center gap-2"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
          <span>⚠️</span>
          <span>{balance.pendientes} movimiento{balance.pendientes === 1 ? '' : 's'} sin cotización — el saldo en USDT es parcial hasta que se complete la cotización.</span>
        </div>
      )}

      {/* Selector de fecha */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.7)' }}>Día</label>
        <input
          type="date"
          value={fecha}
          min={CUTOFF_DATE}
          max={hoyART()}
          onChange={e => setFecha(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.35)', color: 'rgba(226,232,240,0.9)', colorScheme: 'dark' }}
        />
      </div>

      {/* Tabla de órdenes del día */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                {['Fecha y hora', 'Monto (ARS)', `Comisión (${fmtPct(balance?.comisionPct ?? 0)}%)`, 'Cotización USDT', 'Equivalente USDT', 'CUIT/CUIL/DNI', 'Nombre y apellido', 'N° orden', 'Billetera'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'rgba(148,163,184,0.7)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin órdenes acreditadas este día</td></tr>
              ) : (
                rows.map((r, i) => (
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
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(0,212,255,0.75)' }}>{r.billetera}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BalanceCard({ label, value, format, suffix, color, delay, loading, comisionValue, comisionFormat, comisionPct, comisionSuffix }: {
  label: string; value: number; format: (n: number) => string; suffix?: string; color: string; delay: number; loading: boolean
  comisionValue?: number; comisionFormat?: (n: number) => string; comisionPct?: number; comisionSuffix?: string
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
      {!loading && comisionValue != null && comisionValue > 0 && (
        <p className="text-xs font-semibold mt-2" style={{ color: '#f87171' }}>
          Comisión {fmtPct(comisionPct ?? 0)}% · −<AnimatedNumber value={comisionValue} format={comisionFormat ?? format} pop={false} />{comisionSuffix ? ` ${comisionSuffix}` : ''}
        </p>
      )}
    </motion.div>
  )
}
