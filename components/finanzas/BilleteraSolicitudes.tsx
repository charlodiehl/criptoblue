'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import type { Toast } from './FinanzasApp'

// Solicitar pagos desde una billetera: mismo ciclo que las tiendas
// (pendiente → pagada), pero el saldo de billetera es ARS, así que el descuento
// se calcula en ARS. "USD billete" pide monto en USD y cotización.

type Tipo = 'transferencia_ars' | 'usd_billete'

interface Solicitud {
  id: number
  tipo: string
  estado: 'pendiente' | 'pagada'
  datos: { ars?: number; usd?: number; cotizacion?: number; motivo?: string; fecha?: string }
  created_by: string
  created_at: string
  paid_at: string | null
}

// Ahora en horario Argentina, como 'YYYY-MM-DDTHH:mm' para el input datetime-local
function ahoraART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export default function BilleteraSolicitudes({
  wallet, notify, onPagada,
}: { wallet: string; notify: (msg: string, type?: Toast['type']) => void; onPagada: () => void }) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [tipo, setTipo] = useState<Tipo>('transferencia_ars')
  const [montoArs, setMontoArs] = useState('')
  const [montoUsd, setMontoUsd] = useState('')
  const [cotizacion, setCotizacion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(ahoraART())
  const [enviando, setEnviando] = useState(false)
  const [pagando, setPagando] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/finanzas/billetera/solicitudes?wallet=${encodeURIComponent(wallet)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setSolicitudes((await res.json()).solicitudes ?? [])
    } catch (e) {
      notify(`No se pudieron cargar las solicitudes: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }, [wallet, notify])

  useEffect(() => { cargar() }, [cargar])

  // Vista previa del ARS que va a salir, con la misma cuenta que hace el server.
  const arsPrevisto = tipo === 'usd_billete'
    ? (Number(montoUsd) || 0) * (Number(cotizacion) || 0)
    : (Number(montoArs) || 0)

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!(arsPrevisto > 0)) { notify('El monto debe ser mayor a 0', 'error'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/finanzas/billetera/solicitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet, tipo, motivo: motivo.trim() || undefined,
          fecha: new Date(`${fecha}:00-03:00`).toISOString(),
          ...(tipo === 'usd_billete'
            ? { montoUsd: Number(montoUsd), cotizacion: Number(cotizacion) }
            : { montoArs: Number(montoArs) }),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Error')
      notify(`Solicitud #${body.id} creada por ${ARS.format(body.ars)}`, 'success')
      setMontoArs(''); setMontoUsd(''); setCotizacion(''); setMotivo('')
      cargar()
    } catch (e) {
      notify(`No se pudo crear: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setEnviando(false)
    }
  }

  async function pagar(id: number) {
    setPagando(id)
    try {
      const res = await fetch('/api/finanzas/billetera/pagar-solicitud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Error')
      notify(`Solicitud #${id} pagada · −${ARS.format(body.salida.ars)}`, 'success')
      cargar()
      onPagada()   // el saldo cambió: recargar el balance
    } catch (e) {
      notify(`No se pudo pagar: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setPagando(null)
    }
  }

  const input = {
    background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.25)',
    color: 'rgba(226,232,240,0.9)', colorScheme: 'dark' as const,
  }

  return (
    <div className="space-y-5">
      <motion.form
        onSubmit={crear}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)' }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.8)' }}>
          Nuevo pago desde {wallet}
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {([['transferencia_ars', 'Transferencia ARS'], ['usd_billete', 'USD billete']] as [Tipo, string][]).map(([k, label]) => (
            <button
              key={k} type="button" onClick={() => setTipo(k)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: tipo === k ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${tipo === k ? 'rgba(0,212,255,0.4)' : 'rgba(148,163,184,0.12)'}`,
                color: tipo === k ? '#00d4ff' : 'rgba(148,163,184,0.75)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
          {tipo === 'transferencia_ars' ? (
            <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
              <span>Monto ARS</span>
              <input type="number" step="0.01" min="0" required value={montoArs} onChange={e => setMontoArs(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={input} />
            </label>
          ) : (
            <>
              <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
                <span>Monto USD</span>
                <input type="number" step="0.01" min="0" required value={montoUsd} onChange={e => setMontoUsd(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={input} />
              </label>
              <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
                <span>Cotización (ARS por USD)</span>
                <input type="number" step="0.01" min="0" required value={cotizacion} onChange={e => setCotizacion(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={input} />
              </label>
            </>
          )}
          <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
            <span>Fecha y hora del retiro</span>
            <input type="datetime-local" value={fecha} onChange={e => setFecha(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={input} />
          </label>
          <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
            <span>Motivo (opcional)</span>
            <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder={tipo === 'usd_billete' ? 'Retiro usd billete' : 'Transferencia ARS'}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={input} />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
            Sale de la billetera: <span className="font-bold" style={{ color: '#f87171' }}>−{ARS.format(arsPrevisto)}</span>
          </p>
          <button type="submit" disabled={enviando || !(arsPrevisto > 0)}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', color: '#00d4ff' }}>
            {enviando ? 'Creando…' : 'Crear solicitud'}
          </button>
        </div>
      </motion.form>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                {['Fecha', 'Motivo', 'Monto (ARS)', 'Estado', ''].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'rgba(148,163,184,0.7)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {solicitudes.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin solicitudes</td></tr>
              ) : solicitudes.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>
                    {fmtDate(s.datos.fecha ?? s.created_at)}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>
                    {s.datos.motivo || '—'}
                    {s.datos.usd != null && (
                      <span className="text-[11px] ml-1" style={{ color: 'rgba(148,163,184,0.6)' }}>
                        (USD {s.datos.usd.toLocaleString('es-AR')} × {s.datos.cotizacion?.toLocaleString('es-AR')})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#f87171' }}>
                    −{ARS.format(s.datos.ars ?? 0)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                      style={s.estado === 'pagada'
                        ? { background: 'rgba(0,255,136,0.1)', color: '#00ff88' }
                        : { background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                      {s.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    {s.estado === 'pendiente' && (
                      <button onClick={() => pagar(s.id)} disabled={pagando === s.id}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
                        style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88' }}>
                        {pagando === s.id ? 'Pagando…' : 'Marcar pagada'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
