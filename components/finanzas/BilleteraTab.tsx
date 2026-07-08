'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import type { Toast } from './FinanzasApp'

interface Pago {
  fecha: string
  titular: string
  monto: number
  estado: 'emparejado' | 'en_cola'
}
interface Detalle {
  wallet: string
  totalArs: number
  cantidad: number
  totalDia?: number
  cantidadDia?: number
  pagos: Pago[]
}

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
          Ingresos desde el 08/07 (00:00), contados por la fecha de ingreso del pago (emparejados o no) — igual que el balance de tiendas.
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
          {loading && !data ? '—' : ARS.format(data?.totalArs ?? 0)}
        </p>
        <p className="text-xs mt-2" style={{ color: 'rgba(148,163,184,0.5)' }}>
          {data?.cantidad ?? 0} pago{(data?.cantidad ?? 0) === 1 ? '' : 's'} desde el 08/07
        </p>
      </motion.div>

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
            Ingresó este día: <span className="font-bold" style={{ color: '#00ff88' }}>{ARS.format(data.totalDia ?? 0)}</span>
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
                {['Fecha y hora', 'Titular', 'Monto (ARS)', 'Estado'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'rgba(148,163,184,0.7)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</td></tr>
              ) : !data || data.pagos.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin pagos ingresados este día</td></tr>
              ) : (
                data.pagos.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>{fmtDate(p.fecha)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{p.titular || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#00ff88' }}>{ARS.format(p.monto)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-full"
                        style={p.estado === 'emparejado'
                          ? { background: 'rgba(0,255,136,0.1)', color: '#00ff88' }
                          : { background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                        {p.estado === 'emparejado' ? 'Emparejado' : 'En cola'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && (data.cantidadDia ?? 0) > data.pagos.length && (
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Mostrando los {data.pagos.length} pagos más recientes de {data.cantidadDia} del día.
        </p>
      )}
    </div>
  )
}
