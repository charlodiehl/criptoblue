'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import AnimatedNumber, { NumberSkeleton } from '@/components/AnimatedNumber'
import type { Toast } from './FinanzasApp'

interface Pago {
  fecha: string
  titular: string
  monto: number
  comision: number
  estado: 'emparejado' | 'en_cola'
}
interface Reembolso {
  orderNumber: string
  monto: number
  seq: number
  fecha: string
}
interface Detalle {
  wallet: string
  totalArs: number
  cantidad: number
  comisionArs: number
  comisionPct: number
  reembolsosArs: number
  reembolsos: Reembolso[]
  totalDia?: number
  cantidadDia?: number
  pagos: Pago[]
}

const fmtPct = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const fmtArs = (n: number) => ARS.format(n)

// Hoy en horario Argentina (UTC-3) como 'YYYY-MM-DD'
function hoyART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Corte del balance (coincide con BALANCE_CUTOFF de lib/config.ts): no se cuenta
// nada anterior. El server es el que manda; acá solo acota el selector de fecha.
const CUTOFF_DATE = '2026-07-08'

// Vista de ingresos de una billetera: total acumulado desde el corte + extracto
// dividido por día (calendario). Espejo del balance de tienda, pero solo en ARS.
export default function BilleteraTab({ wallet, notify }: { wallet: string; notify: (msg: string, type?: Toast['type']) => void }) {
  const [data, setData] = useState<Detalle | null>(null)
  const [fecha, setFecha] = useState(hoyART())
  const [loading, setLoading] = useState(true)

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

  // Carga inicial + al cambiar de día + refresco cada 60s (entran pagos nuevos)
  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [fetchData])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#00d4ff' }}>Billetera {wallet}</h2>
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Ingresos desde el 08/07 (00:00). El día agrupa por emparejamiento: un pago en cola figura en su día de ingreso y, al emparejarse, pasa al día del match conservando su fecha y hora originales. Los marcados “No es de tiendas” no cuentan.
        </p>
      </div>

      {/* Tarjeta de total acumulado (no cambia con el día) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative rounded-2xl p-6 overflow-hidden max-w-sm"
        style={{ background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)', border: '1px solid #00ff8833', boxShadow: '0 0 20px #00ff8814' }}
      >
        <div className="absolute top-0 right-0 w-28 h-28 opacity-10 rounded-full pointer-events-none"
          style={{ background: '#00ff88', filter: 'blur(32px)', transform: 'translate(30%, -30%)' }} />
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>Ingresos totales</p>
        <p className="text-4xl font-black" style={{ color: '#00ff88', textShadow: '0 0 20px #00ff8860' }}>
          {loading && !data
            ? <NumberSkeleton width={200} height={40} />
            : <AnimatedNumber value={data?.totalArs ?? 0} format={fmtArs} />}
        </p>
        {data && data.comisionArs > 0 && (
          <p className="text-xs font-semibold mt-2" style={{ color: '#f87171' }}>
            Comisión {fmtPct(data.comisionPct)}% · −<AnimatedNumber value={data.comisionArs} format={fmtArs} pop={false} />
          </p>
        )}
        {data && data.reembolsosArs > 0 && (
          <p className="text-xs font-semibold mt-1" style={{ color: '#f87171' }}>
            Reembolsos · −<AnimatedNumber value={data.reembolsosArs} format={fmtArs} pop={false} />
          </p>
        )}
        <p className="text-xs mt-2" style={{ color: 'rgba(148,163,184,0.5)' }}>
          {data?.cantidad ?? 0} pago{(data?.cantidad ?? 0) === 1 ? '' : 's'} desde el 08/07 (comisión y reembolsos ya descontados)
        </p>
      </motion.div>

      {/* Reembolsos que restaron saldo a esta billetera (misma info que a la tienda) */}
      {data && data.reembolsos.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(248,113,113,0.2)' }}>
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(248,113,113,0.85)' }}>
            Reembolsos ({data.reembolsos.length})
          </h3>
          <div className="space-y-1">
            {data.reembolsos.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm flex-wrap">
                <span style={{ color: 'rgba(226,232,240,0.85)' }}>
                  Reembolso orden #{r.orderNumber}{r.seq > 1 ? ` (${r.seq})` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: '#f87171' }}>−{ARS.format(r.monto)}</span>
                  <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>{fmtDate(r.fecha)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selector de día */}
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
        {data && (
          <span className="text-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
            Total de este día: <AnimatedNumber value={data.totalDia ?? 0} format={fmtArs} className="font-bold" style={{ color: '#00ff88' }} />
            <span style={{ color: 'rgba(148,163,184,0.5)' }}> · {data.cantidadDia ?? 0} pago{(data.cantidadDia ?? 0) === 1 ? '' : 's'}</span>
          </span>
        )}
      </div>

      {/* Extracto del día */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                {['Fecha y hora del pago', 'Titular', 'Monto (ARS)', `Comisión (${fmtPct(data?.comisionPct ?? 0)}%)`, 'Estado'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'rgba(148,163,184,0.7)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</td></tr>
              ) : !data || data.pagos.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin pagos este día</td></tr>
              ) : (
                data.pagos.map((p, i) => (
                  <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                    style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(p.fecha)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{p.titular || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#00ff88' }}>{ARS.format(p.monto)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#f87171' }}>−{ARS.format(p.comision)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-full"
                        style={p.estado === 'emparejado'
                          ? { background: 'rgba(0,255,136,0.1)', color: '#00ff88' }
                          : { background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                        {p.estado === 'emparejado' ? 'Emparejado' : 'En cola'}
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
    </div>
  )
}
