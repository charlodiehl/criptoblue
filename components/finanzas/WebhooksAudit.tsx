'use client'

import { useState, useEffect, useCallback } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import type { Toast } from './FinanzasApp'

// ─────────────────────────────────────────────────────────────────────────────
// Auditoría de pagos entrantes por webhook (Notificador, Copter).
//
// Responde lo que antes no se podía responder cuando alguien dice "te mandé el
// pago y me diste OK": si llegó, y si llegó y no se cargó, por qué.
// ─────────────────────────────────────────────────────────────────────────────

interface Ingreso {
  id: number; ts: string; fuente: string; estado: string; motivo: string | null
  payment_id: string | null; id_externo: string | null; monto: number | null
  titular: string | null; fecha_operacion: string | null
  http_status: number | null; duration_ms: number | null
}
interface Datos {
  horas: number; total: number; truncado: boolean
  porEstado: Record<string, number>
  salud: {
    colgados: number; colgadosDetalle: Ingreso[]; saturado: number; lentas: number
    ultimoAceptadoTs: string | null; minutosSinRecibir: number | null
  }
  ingresos: Ingreso[]
}

const ESTADOS: Record<string, { label: string; color: string; ayuda: string }> = {
  aceptado:  { label: 'Cargado',    color: '#00ff88', ayuda: 'El pago entró a la cola.' },
  duplicado: { label: 'Duplicado',  color: '#a78bfa', ayuda: 'Ese id ya se había recibido: se respondió OK pero NO se cargó de nuevo.' },
  ignorado:  { label: 'Ignorado',   color: '#fbbf24', ayuda: 'No era un ingreso (otro tipo de evento).' },
  rechazado: { label: 'Rechazado',  color: '#fb923c', ayuda: 'Datos inválidos o sin autorización.' },
  error:     { label: 'Error',      color: '#f87171', ayuda: 'Falló de nuestro lado.' },
  recibido:  { label: 'Sin cerrar', color: '#f87171', ayuda: 'Llegó pero el proceso nunca terminó: el endpoint se cayó o estaba saturado.' },
}

const HORAS = [24, 48, 24 * 7, 24 * 30]
const horasTxt = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} días`)

export default function WebhooksAudit({ notify }: { notify: (msg: string, type?: Toast['type']) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [horas, setHoras] = useState(48)
  const [filtro, setFiltro] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchDatos = useCallback(async (h: number, estado: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/finanzas/webhooks?horas=${h}${estado ? `&estado=${estado}` : ''}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setDatos(await res.json())
    } catch (e) {
      notify(`No se pudo cargar la auditoría: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { fetchDatos(horas, filtro) }, [horas, filtro, fetchDatos])

  const s = datos?.salud
  // Sano = nada colgado a mitad de proceso y nada rebotado por saturación.
  const sano = !!s && s.colgados === 0 && s.saturado === 0

  return (
    <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.8)' }}>
            Pagos que entran por webhook
          </h3>
          <p className="text-[11px] mt-1 max-w-2xl" style={{ color: 'rgba(148,163,184,0.5)' }}>
            Queda registrada <b style={{ color: 'rgba(148,163,184,0.75)' }}>toda</b> request que llega, se cargue o no.
            Si alguien dice “te lo mandé y me diste OK”, acá está la prueba de qué pasó.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {HORAS.map(h => (
            <button key={h} onClick={() => setHoras(h)}
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
              style={{
                background: horas === h ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${horas === h ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: horas === h ? '#00d4ff' : 'rgba(148,163,184,0.7)', cursor: 'pointer',
              }}>{horasTxt(h)}</button>
          ))}
        </div>
      </div>

      {/* Salud del endpoint */}
      {s && (
        <div className="mt-4 rounded-xl px-4 py-3 text-xs flex items-center gap-2.5 flex-wrap"
          style={{
            background: sano ? 'rgba(0,255,136,0.06)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${sano ? 'rgba(0,255,136,0.25)' : 'rgba(248,113,113,0.3)'}`,
            color: sano ? '#00ff88' : '#f87171',
          }}>
          <span>{sano ? '✓' : '⚠️'}</span>
          {sano ? (
            <span>
              El endpoint respondió todo lo que le llegó.
              {s.ultimoAceptadoTs && <span style={{ opacity: 0.75 }}> · último pago cargado hace {s.minutosSinRecibir} min</span>}
            </span>
          ) : (
            <span>
              {s.colgados > 0 && <b>{s.colgados} request{s.colgados === 1 ? '' : 's'} que nunca cerró: el endpoint se cayó o estaba saturado. </b>}
              {s.saturado > 0 && <b>{s.saturado} rebotada{s.saturado === 1 ? '' : 's'} por sistema ocupado. </b>}
              Esos pagos hay que recuperarlos a mano.
            </span>
          )}
          {s.lentas > 0 && <span style={{ opacity: 0.7 }}>· {s.lentas} tardaron más de 5s</span>}
        </div>
      )}

      {/* Resumen por estado — también funciona de filtro */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <Chip label="Todos" valor={datos?.total ?? 0} color="#00d4ff" activo={filtro === ''} onClick={() => setFiltro('')} />
        {Object.entries(datos?.porEstado ?? {}).sort().map(([k, v]) => (
          <Chip key={k} label={ESTADOS[k]?.label ?? k} valor={v} color={ESTADOS[k]?.color ?? '#94a3b8'}
            activo={filtro === k} onClick={() => setFiltro(filtro === k ? '' : k)} ayuda={ESTADOS[k]?.ayuda} />
        ))}
      </div>

      {loading && !datos ? (
        <p className="text-sm py-8 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
      ) : !datos?.ingresos.length ? (
        <p className="text-sm py-8 text-center" style={{ color: 'rgba(148,163,184,0.45)' }}>
          {filtro ? 'Nada con ese estado en el período.' : 'No entró ningún pago por webhook en el período.'}
        </p>
      ) : (
        <div className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.1)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: '860px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                  {['Fecha y hora', 'Origen', 'Estado', 'Monto', 'Titular', 'Qué pasó'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'rgba(148,163,184,0.6)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datos.ingresos.map(i => {
                  const e = ESTADOS[i.estado] ?? { label: i.estado, color: '#94a3b8', ayuda: '' }
                  return (
                    <tr key={i.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.8)' }}>{fmtDate(i.ts)}</td>
                      <td className="px-3 py-2" style={{ color: 'rgba(148,163,184,0.7)' }}>{i.fuente}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-md px-2 py-0.5 font-semibold whitespace-nowrap"
                          style={{ background: `${e.color}1a`, border: `1px solid ${e.color}40`, color: e.color }}>{e.label}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>
                        {i.monto != null ? ARS.format(i.monto) : '—'}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'rgba(226,232,240,0.75)' }}>{i.titular || '—'}</td>
                      <td className="px-3 py-2" style={{ color: 'rgba(148,163,184,0.65)' }}>{i.motivo || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {datos?.truncado && (
        <p className="text-[11px] mt-2" style={{ color: '#fbbf24' }}>
          Se muestran los 500 más recientes: hay más en el período, achicá el rango.
        </p>
      )}
    </div>
  )
}

function Chip({ label, valor, color, activo, onClick, ayuda }: {
  label: string; valor: number; color: string; activo: boolean; onClick: () => void; ayuda?: string
}) {
  return (
    <button onClick={onClick} title={ayuda}
      className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
      style={{
        background: activo ? `${color}22` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${activo ? `${color}66` : 'rgba(255,255,255,0.08)'}`,
        color: activo ? color : 'rgba(148,163,184,0.75)', cursor: 'pointer',
      }}>
      {label} <span style={{ opacity: 0.75 }}>{valor}</span>
    </button>
  )
}
