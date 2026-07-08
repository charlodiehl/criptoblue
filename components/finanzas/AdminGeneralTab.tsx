'use client'

import { useState, useEffect, useCallback } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import type { TransferRequest, TransferTipo } from '@/lib/types'
import SolicitudModal from './SolicitudModal'
import type { Toast } from './FinanzasApp'

export type SolicitudConTienda = TransferRequest & { storeName: string }
interface Reclamo { timestamp: string; storeId: string; storeName: string; amount: number; orderNumber: string }

const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'una transferencia ARS',
  usd: 'una transferencia USD',
  usdt: 'una transferencia USDT',
}

interface Props {
  notify: (msg: string, type?: Toast['type']) => void
  onSolicitudPagada: () => void
}

export default function AdminGeneralTab({ notify, onSolicitudPagada }: Props) {
  const [solicitudes, setSolicitudes] = useState<SolicitudConTienda[]>([])
  const [reclamos, setReclamos] = useState<Reclamo[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<SolicitudConTienda | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [rs, rr] = await Promise.all([
        fetch('/api/finanzas/solicitudes?estado=pendiente'),
        fetch('/api/finanzas/reclamos'),
      ])
      if (rs.ok) setSolicitudes((await rs.json()).solicitudes || [])
      if (rr.ok) setReclamos((await rr.json()).reclamos || [])
    } catch (e) {
      notify(`No se pudo cargar la central: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  // Carga inicial + refresco cada 60s
  useEffect(() => {
    fetchAll()
    const iv = setInterval(fetchAll, 60_000)
    return () => clearInterval(iv)
  }, [fetchAll])

  function handlePagada() {
    setModal(null)
    fetchAll()
    onSolicitudPagada()  // refresca los balances de la franja superior
  }

  return (
    <div className="space-y-6">
      {/* Solicitudes pendientes */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.8)' }}>
          Transferencias solicitadas {solicitudes.length > 0 && <span style={{ color: '#fbbf24' }}>· {solicitudes.length} pendiente{solicitudes.length === 1 ? '' : 's'}</span>}
        </h3>
        {loading ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="text-sm py-6 text-center rounded-xl" style={{ color: 'rgba(148,163,184,0.5)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)' }}>
            No hay solicitudes pendientes.
          </p>
        ) : (
          <div className="space-y-2">
            {solicitudes.map(s => (
              <div key={s.id} className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
                style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(226,232,240,0.9)' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
                  <span className="font-bold" style={{ color: '#00d4ff' }}>{s.storeName}</span>
                  <span>solicitó</span>
                  <span className="font-semibold">{TIPO_LABEL[s.tipo]}</span>
                  <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>· {fmtDate(s.createdAt)}</span>
                </div>
                <button onClick={() => setModal(s)}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: 'pointer' }}>
                  Ver detalles
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reclamos (informativo) */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>
          Pagos adjudicados por tiendas · últimos 7 días
        </h3>
        {reclamos.length === 0 ? (
          <p className="text-sm py-4 text-center rounded-xl" style={{ color: 'rgba(148,163,184,0.45)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)' }}>
            Sin reclamos recientes.
          </p>
        ) : (
          <div className="space-y-1.5">
            {reclamos.map((r, i) => (
              <div key={i} className="rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)', color: 'rgba(226,232,240,0.75)' }}>
                <span className="font-semibold" style={{ color: '#00d4ff' }}>{r.storeName}</span>
                <span>se adjudicó un pago de</span>
                <span className="font-bold" style={{ color: '#00ff88' }}>{ARS.format(r.amount)}</span>
                {r.orderNumber && <span>(orden #{r.orderNumber})</span>}
                <span className="text-[11px] ml-auto" style={{ color: 'rgba(148,163,184,0.45)' }}>{fmtDate(r.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {modal && (
        <SolicitudModal solicitud={modal} notify={notify} onClose={() => setModal(null)} onPaid={handlePagada} />
      )}
    </div>
  )
}
