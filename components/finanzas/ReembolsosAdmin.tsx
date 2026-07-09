'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import ComprobanteInput from '@/components/ComprobanteInput'
import type { RefundRequest } from '@/lib/types'
import type { Toast } from './FinanzasApp'

interface Props {
  notify: (msg: string, type?: Toast['type']) => void
  onReembolsado: () => void   // refresca los balances de arriba
}

type SolicitudConTienda = RefundRequest & { storeName: string }
interface OrdenResult {
  order: { orderNumber: string; orderId: string; total: number; customerName: string; createdAt: string; wallet: string | null }
  reembolsos: { reembolsado: number; restante: number; count: number; historial: { seq: number; monto: number; fecha: string }[] }
}

const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
}
const fmtNum = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

export default function ReembolsosAdmin({ notify, onReembolsado }: Props) {
  const [tiendas, setTiendas] = useState<{ storeId: string; storeName: string }[]>([])
  const [solicitudes, setSolicitudes] = useState<SolicitudConTienda[]>([])

  // Herramienta de reembolso
  const [open, setOpen] = useState(false)
  const [storeId, setStoreId] = useState('')
  const [orden, setOrden] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<OrdenResult | null>(null)
  const [monto, setMonto] = useState('')
  const [cotizacion, setCotizacion] = useState('')
  const [comprobantePath, setComprobantePath] = useState<string | null>(null)
  const [compKey, setCompKey] = useState(0)   // remonta el ComprobanteInput al buscar/refrescar
  const [ejecutando, setEjecutando] = useState(false)
  const [requestId, setRequestId] = useState<number | null>(null)   // si viene de una solicitud
  const toolRef = useRef<HTMLDivElement>(null)

  const fetchTiendas = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/comisiones')
      if (res.ok) {
        const data = await res.json()
        setTiendas((data.tiendas || []).map((t: { storeId: string; storeName: string }) => ({ storeId: t.storeId, storeName: t.storeName })))
      }
    } catch { /* silencioso */ }
  }, [])

  const fetchSolicitudes = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/reembolsos-solicitados')
      if (res.ok) setSolicitudes((await res.json()).solicitudes || [])
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => {
    fetchTiendas(); fetchSolicitudes()
    const iv = setInterval(fetchSolicitudes, 60_000)
    return () => clearInterval(iv)
  }, [fetchTiendas, fetchSolicitudes])

  function resetForm() {
    setResultado(null); setMonto(''); setCotizacion(''); setComprobantePath(null); setRequestId(null)
  }

  const buscar = useCallback(async (sid: string, ord: string) => {
    if (!sid || !ord.trim()) { notify('Elegí la tienda e ingresá el número de orden', 'error'); return }
    setBuscando(true); setResultado(null); setComprobantePath(null); setCompKey(k => k + 1)
    try {
      const res = await fetch('/api/finanzas/reembolso/buscar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: sid, orderNumber: ord.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setResultado(data)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo buscar la orden', 'error')
    } finally {
      setBuscando(false)
    }
  }, [notify])

  async function ejecutar() {
    if (ejecutando || !resultado) return
    const m = Number(monto.replace(',', '.'))
    const cot = Number(cotizacion.replace(',', '.'))
    if (!Number.isFinite(m) || m <= 0) { notify('Ingresá el monto a reembolsar', 'error'); return }
    if (m > resultado.reembolsos.restante + 0.01) { notify(`El monto supera lo disponible (${fmtNum(resultado.reembolsos.restante)})`, 'error'); return }
    if (!Number.isFinite(cot) || cot <= 0) { notify('Ingresá la cotización USDT/ARS', 'error'); return }
    if (!comprobantePath) { notify('El comprobante es obligatorio', 'error'); return }

    setEjecutando(true)
    try {
      const res = await fetch('/api/finanzas/reembolso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderNumber: resultado.order.orderNumber, monto: m, cotizacion: cot, comprobantePath, requestId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(`${data.descripcion} · se restó ${ARS.format(m)} del saldo ✓`, 'success')
      onReembolsado()
      fetchSolicitudes()
      // Refrescar la orden para ver el nuevo disponible (por si hay más parciales)
      setMonto(''); setComprobantePath(null); setRequestId(null)
      buscar(storeId, resultado.order.orderNumber)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo ejecutar el reembolso', 'error')
    } finally {
      setEjecutando(false)
    }
  }

  function procesarSolicitud(s: SolicitudConTienda) {
    setOpen(true)
    setStoreId(s.storeId)
    setOrden(String(s.orderNumber))
    setRequestId(s.id)
    setMonto(s.montoSolicitado != null ? String(s.montoSolicitado) : '')
    setCotizacion('')
    setComprobantePath(null)
    buscar(s.storeId, String(s.orderNumber))
    setTimeout(() => toolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const restante = resultado?.reembolsos.restante ?? 0
  const montoNum = Number(monto.replace(',', '.'))
  const cotNum = Number(cotizacion.replace(',', '.'))
  const usdtPreview = Number.isFinite(montoNum) && Number.isFinite(cotNum) && cotNum > 0 ? montoNum / cotNum : null
  const puedeEjecutar = !!resultado && Number.isFinite(montoNum) && montoNum > 0 && montoNum <= restante + 0.01
    && Number.isFinite(cotNum) && cotNum > 0 && !!comprobantePath && !ejecutando

  return (
    <div className="space-y-4">
      {/* Solicitudes de reembolso de las tiendas */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.8)' }}>
          Reembolsos solicitados {solicitudes.length > 0 && <span style={{ color: '#fbbf24' }}>· {solicitudes.length} pendiente{solicitudes.length === 1 ? '' : 's'}</span>}
        </h3>
        {solicitudes.length === 0 ? (
          <p className="text-sm py-4 text-center rounded-xl" style={{ color: 'rgba(148,163,184,0.5)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)' }}>
            No hay solicitudes de reembolso.
          </p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {solicitudes.map(s => (
                <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
                  style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <div className="flex items-center gap-2 text-sm flex-wrap" style={{ color: 'rgba(226,232,240,0.9)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
                    <span className="font-bold" style={{ color: '#00d4ff' }}>{s.storeName}</span>
                    <span>pide reembolsar la orden</span>
                    <span className="font-semibold">#{s.orderNumber}</span>
                    {s.montoSolicitado != null && <span style={{ color: '#00ff88' }}>· {ARS.format(s.montoSolicitado)}</span>}
                    <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>· {fmtDate(s.createdAt)}</span>
                  </div>
                  <button onClick={() => procesarSolicitud(s)}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: 'pointer' }}>
                    Procesar
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Herramienta de reembolso (solapa desplegable) */}
      <section ref={toolRef}>
        <button onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between gap-2 rounded-xl px-3 sm:px-4 py-3 text-[13px] sm:text-sm font-semibold transition-all"
          style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', color: '#00d4ff', cursor: 'pointer' }}>
          <span className="flex items-center gap-2 min-w-0 text-left">
            <span className="shrink-0">↩️</span>
            <span>Gestión de reembolsos</span>
          </span>
          <span className="shrink-0" style={{ fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="mt-3 rounded-xl p-3 sm:p-4 space-y-4"
            style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
            {/* Selección de tienda + orden */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 sm:items-end">
              <div>
                <label style={labelStyle}>Tienda</label>
                <select value={storeId} onChange={e => { setStoreId(e.target.value); resetForm() }}
                  style={{ ...inputStyle, colorScheme: 'dark', cursor: 'pointer' }}>
                  <option value="" style={optionStyle}>Elegí la tienda…</option>
                  {tiendas.map(t => <option key={t.storeId} value={t.storeId} style={optionStyle}>{t.storeName}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Número de orden</label>
                <input style={inputStyle} value={orden} onChange={e => setOrden(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') buscar(storeId, orden) }} placeholder="Ej: 18441" />
              </div>
              <button onClick={() => buscar(storeId, orden)} disabled={buscando || !storeId || !orden.trim()}
                className="rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50 w-full sm:w-auto"
                style={{ padding: '11px 20px', background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: buscando ? 'wait' : 'pointer' }}>
                {buscando ? 'Buscando…' : '🔍 Buscar'}
              </button>
            </div>

            {/* Resultado */}
            {resultado && (
              <div className="space-y-4">
                <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(0,212,255,0.15)' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm font-bold" style={{ color: '#00d4ff' }}>Orden #{resultado.order.orderNumber}</div>
                    <div className="text-sm font-black" style={{ color: '#00ff88' }}>Total: {ARS.format(resultado.order.total)}</div>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>
                    {resultado.order.customerName || 'Sin nombre'} · {fmtDate(resultado.order.createdAt)}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>
                    Billetera de origen: <span className="font-semibold" style={{ color: '#00d4ff' }}>{resultado.order.wallet || '—'}</span>
                    {resultado.order.wallet && <span> · se le restará el reembolso</span>}
                  </div>
                </div>

                {/* Advertencia de reembolso previo */}
                {resultado.reembolsos.count > 0 && (
                  <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <div className="text-sm font-bold mb-1" style={{ color: '#fbbf24' }}>
                      ⚠️ Esta orden ya tiene {resultado.reembolsos.count} reembolso{resultado.reembolsos.count === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs" style={{ color: 'rgba(226,232,240,0.8)' }}>
                      Ya reembolsado: <span className="font-bold" style={{ color: '#f87171' }}>{ARS.format(resultado.reembolsos.reembolsado)}</span> de {ARS.format(resultado.order.total)}
                      {' · '}Disponible: <span className="font-bold" style={{ color: '#00ff88' }}>{ARS.format(resultado.reembolsos.restante)}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {resultado.reembolsos.historial.map(h => (
                        <div key={h.seq} className="text-[11px]" style={{ color: 'rgba(148,163,184,0.7)' }}>
                          Reembolso {h.seq > 1 ? `(${h.seq})` : '#1'}: <span style={{ color: '#f87171' }}>−{ARS.format(h.monto)}</span> · {fmtDate(h.fecha)}
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] mt-2" style={{ color: 'rgba(148,163,184,0.6)' }}>
                      Si continuás, este reembolso se anota como <span className="font-semibold">reembolso orden #{resultado.order.orderNumber} ({resultado.reembolsos.count + 1})</span>.
                    </div>
                  </div>
                )}

                {resultado.reembolsos.restante <= 0 ? (
                  <div className="rounded-xl p-4 text-sm text-center" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                    Esta orden ya fue reembolsada en su totalidad. No queda saldo disponible para reembolsar.
                  </div>
                ) : (
                  <>
                    {requestId != null && (
                      <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', color: 'rgba(0,212,255,0.85)' }}>
                        Procesando la solicitud de la tienda. Podés ajustar el monto final antes de confirmar.
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label style={labelStyle}>Monto a reembolsar (ARS)</label>
                        <input type="number" inputMode="decimal" min="0" step="0.01" style={inputStyle} value={monto}
                          onChange={e => setMonto(e.target.value)} placeholder="0.00" />
                        <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>Disponible: {ARS.format(restante)}</div>
                      </div>
                      <div>
                        <label style={labelStyle}>Cotización USDT/ARS</label>
                        <input type="number" inputMode="decimal" min="0" step="0.0001" style={inputStyle} value={cotizacion}
                          onChange={e => setCotizacion(e.target.value)} placeholder="Cuántos ARS = 1 USDT" />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Comprobante (obligatorio)</label>
                      <ComprobanteInput key={compKey} uploadUrl="/api/finanzas/reembolso/comprobante" onChange={setComprobantePath} notify={notify} disabled={ejecutando} />
                    </div>

                    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                      {usdtPreview != null && montoNum > 0 ? (
                        <span style={{ color: 'rgba(226,232,240,0.85)' }}>
                          Se restará del saldo: <span className="font-bold" style={{ color: '#f87171' }}>{ARS.format(montoNum)}</span> y{' '}
                          <span className="font-bold" style={{ color: '#f87171' }}>{fmtNum(usdtPreview)} USDT</span>.
                        </span>
                      ) : (
                        <span style={{ color: 'rgba(148,163,184,0.5)' }}>Completá monto y cotización para ver el descuento.</span>
                      )}
                    </div>

                    <button onClick={ejecutar} disabled={!puedeEjecutar}
                      className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                      style={{ background: puedeEjecutar ? 'linear-gradient(135deg, #f87171, #dc2626)' : 'rgba(248,113,113,0.15)', cursor: puedeEjecutar ? 'pointer' : 'not-allowed' }}>
                      {ejecutando ? 'Ejecutando reembolso…' : 'Ejecutar reembolso y restar saldo'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
