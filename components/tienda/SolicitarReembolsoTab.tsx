'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import MontoInput from '@/components/MontoInput'
import type { RefundRequest } from '@/lib/types'
import type { Toast } from './TiendaPortal'

interface Props {
  storeId: string
  qs: string
  notify: (msg: string, type?: Toast['type']) => void
}

interface OrdenResult {
  order: { orderNumber: string; total: number; customerName: string; createdAt: string }
  reembolsos: { reembolsado: number; restante: number }
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}

const ESTADO_LABEL: Record<RefundRequest['estado'], { txt: string; style: React.CSSProperties }> = {
  pendiente: { txt: 'Pendiente', style: { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' } },
  procesada: { txt: 'Reembolsada', style: { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' } },
  rechazada: { txt: 'Rechazada', style: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' } },
}

export default function SolicitarReembolsoTab({ qs, notify }: Props) {
  const [orden, setOrden] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<OrdenResult | null>(null)
  const [monto, setMonto] = useState('')
  const [aliasCbu, setAliasCbu] = useState('')   // obligatorio: dónde recibir la plata
  const [titular, setTitular] = useState('')     // opcional: si la cuenta es de un tercero
  const [enviando, setEnviando] = useState(false)
  const [solicitudes, setSolicitudes] = useState<RefundRequest[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/tienda/reembolsos${qs}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setSolicitudes((await res.json()).solicitudes || [])
    } catch (e) {
      notify(`No se pudieron cargar tus solicitudes: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingList(false)
    }
  }, [qs, notify])

  useEffect(() => { fetchList() }, [fetchList])

  async function buscar() {
    if (buscando || !orden.trim()) { notify('Ingresá el número de orden', 'error'); return }
    setBuscando(true); setResultado(null); setMonto(''); setAliasCbu(''); setTitular('')
    try {
      const res = await fetch(`/api/tienda/reembolso/buscar${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: orden.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setResultado(data)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo buscar la orden', 'error')
    } finally {
      setBuscando(false)
    }
  }

  async function enviar() {
    if (enviando || !resultado) return
    const m = Number(monto.replace(',', '.'))
    if (!Number.isFinite(m) || m <= 0) { notify('Ingresá el monto a reembolsar', 'error'); return }
    if (m > resultado.reembolsos.restante + 0.01) { notify(`El monto supera lo disponible (${resultado.reembolsos.restante.toLocaleString('es-AR')})`, 'error'); return }
    // Sin alias/CBU el admin no tiene a dónde transferir: se corta acá.
    if (!aliasCbu.trim()) { notify('Ingresá el alias o CBU donde querés recibir el reembolso', 'error'); return }
    setEnviando(true)
    try {
      const res = await fetch(`/api/tienda/reembolso${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: resultado.order.orderNumber, monto: m,
          aliasCbu: aliasCbu.trim(), titular: titular.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(`Solicitud de reembolso enviada para la orden #${data.orderNumber} ✓`, 'success')
      setResultado(null); setOrden(''); setMonto(''); setAliasCbu(''); setTitular('')
      fetchList()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo enviar la solicitud', 'error')
    } finally {
      setEnviando(false)
    }
  }

  const restante = resultado?.reembolsos.restante ?? 0
  const yaReembolsado = (resultado?.reembolsos.reembolsado ?? 0) > 0

  return (
    <div className="space-y-6">
      {/* Buscar orden y solicitar */}
      <div className="rounded-2xl p-4 sm:p-6 space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>
          Buscá una orden tuya por número. Si existe y todavía tiene saldo reembolsable, podés enviar una solicitud de reembolso al Super Admin.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:items-end">
          <div>
            <label style={labelStyle}>Número de orden</label>
            <input style={inputStyle} value={orden} onChange={e => setOrden(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscar() }} placeholder="Ej: 18441" />
          </div>
          <button onClick={buscar} disabled={buscando || !orden.trim()}
            className="rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50 w-full sm:w-auto"
            style={{ padding: '11px 22px', background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: buscando ? 'wait' : 'pointer' }}>
            {buscando ? 'Buscando…' : '🔍 Buscar orden'}
          </button>
        </div>

        {resultado && (
          <div className="space-y-4 pt-1">
            <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(0,212,255,0.15)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-bold" style={{ color: '#00d4ff' }}>Orden #{resultado.order.orderNumber}</div>
                <div className="text-sm font-black" style={{ color: '#00ff88' }}>Total: {ARS.format(resultado.order.total)}</div>
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>
                {resultado.order.customerName || 'Sin nombre'} · {fmtDate(resultado.order.createdAt)}
              </div>
            </div>

            {yaReembolsado && (
              <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}>
                Esta orden ya tiene reembolsos por {ARS.format(resultado.reembolsos.reembolsado)}. Disponible para reembolsar: <span className="font-bold">{ARS.format(restante)}</span>.
              </div>
            )}

            {restante <= 0 ? (
              <div className="rounded-xl p-4 text-sm text-center" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                Esta orden ya fue reembolsada en su totalidad.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label style={labelStyle}>Monto a reembolsar (ARS)</label>
                  <MontoInput style={inputStyle} value={monto} onChange={setMonto} placeholder="0,00" />
                  <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>Disponible: {ARS.format(restante)} · el Super Admin decide el monto final</div>
                </div>

                {/* Dónde recibir la plata. Sin el alias/CBU el admin no puede transferir,
                    así que es obligatorio; el titular solo hace falta si la cuenta es de
                    otra persona. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={labelStyle}>Alias o CBU <span style={{ color: '#f87171' }}>*</span></label>
                    <input style={inputStyle} value={aliasCbu} onChange={e => setAliasCbu(e.target.value)}
                      maxLength={100} placeholder="mi.alias.mp o 0000003100000000000000" disabled={enviando} />
                  </div>
                  <div>
                    <label style={labelStyle}>Nombre del titular <span style={{ color: 'rgba(148,163,184,0.5)', fontWeight: 400 }}>(opcional)</span></label>
                    <input style={inputStyle} value={titular} onChange={e => setTitular(e.target.value)}
                      maxLength={100} placeholder="Si la cuenta es de otra persona" disabled={enviando} />
                  </div>
                </div>

                <button onClick={enviar} disabled={enviando || !aliasCbu.trim()}
                  className="rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50 w-full sm:w-auto"
                  style={{ padding: '11px 22px', background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: enviando ? 'wait' : 'pointer' }}>
                  {enviando ? 'Enviando…' : 'Solicitar reembolso'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mis solicitudes de reembolso */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.7)' }}>Mis solicitudes de reembolso</h3>
        {loadingList ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Todavía no solicitaste reembolsos.</p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {solicitudes.map(s => {
                const est = ESTADO_LABEL[s.estado]
                return (
                  <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl p-4"
                    style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>Orden #{s.orderNumber}</span>
                        {s.montoSolicitado != null && <span className="text-sm font-bold" style={{ color: '#00d4ff' }}>{ARS.format(s.montoSolicitado)}</span>}
                      </div>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide" style={est.style}>{est.txt}</span>
                    </div>
                    <div className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                      Solicitada: {fmtDate(s.createdAt)}{s.processedAt ? ` · Resuelta: ${fmtDate(s.processedAt)}` : ''}
                    </div>
                    {s.createdBy && (
                      <div className="text-[11px] mt-0.5 break-all" style={{ color: 'rgba(148,163,184,0.5)' }}>
                        Solicitado por: <span style={{ color: 'rgba(148,163,184,0.75)' }}>{s.createdBy}</span>
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
