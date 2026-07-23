'use client'

import { useState, useEffect, useCallback } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import MontoInput from '@/components/MontoInput'
import ConceptoInput from '@/components/ConceptoInput'
import type { Toast } from './TiendaPortal'

interface Props {
  storeId: string
  qs: string
  admin?: boolean
  notify: (msg: string, type?: Toast['type']) => void
}

interface PagoEncontrado {
  mpPaymentId: string
  monto: number
  nombrePagador: string
  fechaPago: string
  billetera: string
  estado: 'disponible' | 'usado'
  ordenPropia?: string   // si el pago ya se usó en una orden de ESTA tienda
}

interface Adjudicacion {
  id: number
  timestamp: string
  monto: number
  nombrePagador: string
  orderNumber: string
  estado: 'pendiente' | 'adjudicada' | 'rechazada'
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)',
  color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}

const ESTADO_ADJ: Record<Adjudicacion['estado'], { txt: string; style: React.CSSProperties }> = {
  pendiente: { txt: 'Pendiente de confirmación', style: { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' } },
  adjudicada: { txt: 'Adjudicada', style: { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' } },
  rechazada: { txt: 'Rechazada', style: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' } },
}

export default function BuscarPagosTab({ qs, notify }: Props) {
  const [nombre, setNombre] = useState('')
  const [monto, setMonto] = useState('')
  const [fechaHora, setFechaHora] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<{ found: boolean; pagos: PagoEncontrado[] } | null>(null)

  // Reclamo inline por tarjeta
  const [reclamando, setReclamando] = useState<string | null>(null)   // mpPaymentId con el input abierto
  const [ordenInput, setOrdenInput] = useState('')
  const [enviandoReclamo, setEnviandoReclamo] = useState(false)
  // Prompt "la orden no existe → ¿adjudicar sujeto a confirmación?" para la tarjeta abierta.
  const [confirmacion, setConfirmacion] = useState<{ mpPaymentId: string; orderNumber: string; message: string } | null>(null)
  // Concepto para el reclamo sin orden válida (no es una venta → lleva etiqueta libre).
  const [conceptoReclamo, setConceptoReclamo] = useState('')

  // Historial de pagos reclamados por la tienda
  const [historial, setHistorial] = useState<Adjudicacion[]>([])
  const [loadingHist, setLoadingHist] = useState(true)

  const fetchHistorial = useCallback(async () => {
    setLoadingHist(true)
    try {
      const res = await fetch(`/api/tienda/reclamos${qs}`)
      if (res.ok) setHistorial((await res.json()).adjudicaciones || [])
    } catch { /* ignore */ } finally {
      setLoadingHist(false)
    }
  }, [qs])

  useEffect(() => { fetchHistorial() }, [fetchHistorial])

  async function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    if (buscando) return
    if (!nombre.trim() || !monto || !fechaHora) {
      notify('Completá nombre, monto y fecha/hora', 'error')
      return
    }
    setBuscando(true)
    setResultado(null)
    setReclamando(null)
    setConfirmacion(null)
    try {
      const res = await fetch(`/api/tienda/buscar-pago${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), monto: Number(monto), fechaHora }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setResultado(data)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error al buscar', 'error')
    } finally {
      setBuscando(false)
    }
  }

  function abrirReclamo(mpPaymentId: string) {
    setReclamando(mpPaymentId)
    setOrdenInput('')
    setConfirmacion(null)
    setConceptoReclamo('')
  }

  function quitarDeResultados(mpPaymentId: string) {
    setResultado(r => r ? { ...r, pagos: r.pagos.filter(p => p.mpPaymentId !== mpPaymentId) } : r)
    setReclamando(null)
    setOrdenInput('')
    setConfirmacion(null)
  }

  // Paso 1: intenta reclamar con la orden. Si existe → se marca y listo. Si NO existe
  // → el server responde needsConfirmation y mostramos el aviso + "Aceptar".
  async function confirmarReclamo(pago: PagoEncontrado) {
    if (enviandoReclamo) return
    if (!ordenInput.trim()) { notify('Ingresá el número de orden', 'error'); return }
    setEnviandoReclamo(true)
    setConfirmacion(null)
    try {
      const res = await fetch(`/api/tienda/reclamar${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId: pago.mpPaymentId, orderNumber: ordenInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      if (data.needsConfirmation) {
        setConfirmacion({ mpPaymentId: pago.mpPaymentId, orderNumber: ordenInput.trim(), message: data.message })
        return
      }
      notify(`Pago reclamado y orden #${data.orderNumber} marcada ✓`, 'success')
      quitarDeResultados(pago.mpPaymentId)
      fetchHistorial()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo reclamar', 'error')
    } finally {
      setEnviandoReclamo(false)
    }
  }

  // Paso 2: la tienda acepta adjudicar aunque la orden no exista → queda pendiente.
  async function aceptarAdjudicacion(pago: PagoEncontrado) {
    if (enviandoReclamo || !confirmacion) return
    setEnviandoReclamo(true)
    try {
      const res = await fetch(`/api/tienda/reclamar${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId: pago.mpPaymentId, orderNumber: confirmacion.orderNumber, forzar: true, concepto: conceptoReclamo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify('Adjudicación enviada. Queda pendiente de confirmación del administrador.', 'success')
      quitarDeResultados(pago.mpPaymentId)
      fetchHistorial()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo enviar', 'error')
    } finally {
      setEnviandoReclamo(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Formulario de búsqueda */}
      <form onSubmit={handleBuscar} className="rounded-2xl p-4 sm:p-6"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
        <p className="text-xs mb-4" style={{ color: 'rgba(148,163,184,0.6)' }}>
          Buscá un pago que hayas recibido para reclamarlo. Los 3 datos son obligatorios: el monto debe coincidir exacto, el nombre puede ser parcial, y la fecha/hora puede diferir hasta 24 horas.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label style={labelStyle}>Nombre y apellido *</label>
            <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del que pagó" /></div>
          <div><label style={labelStyle}>Monto exacto *</label>
            <MontoInput style={inputStyle} value={monto} onChange={setMonto} placeholder="0,00" /></div>
          <div><label style={labelStyle}>Fecha y hora del pago *</label>
            <input type="datetime-local" style={{ ...inputStyle, colorScheme: 'dark' }} value={fechaHora} onChange={e => setFechaHora(e.target.value)} /></div>
        </div>
        <button type="submit" disabled={buscando}
          className="w-full mt-4 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', boxShadow: '0 0 20px rgba(0,212,255,0.25)', cursor: buscando ? 'not-allowed' : 'pointer' }}>
          {buscando ? 'Buscando…' : '🔍 Buscar pago'}
        </button>
      </form>

      {/* Resultados */}
      {resultado && !resultado.found && (
        <div className="rounded-xl p-5 text-center text-sm"
          style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', color: 'rgba(226,232,240,0.75)' }}>
          No hay coincidencias con ese pago.
        </div>
      )}

      {resultado && resultado.found && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,255,136,0.75)' }}>
            {resultado.pagos.length} pago{resultado.pagos.length === 1 ? '' : 's'} encontrado{resultado.pagos.length === 1 ? '' : 's'}
          </h3>
          {resultado.pagos.map(pago => {
            const usado = pago.estado === 'usado'
            const enConfirmacion = confirmacion?.mpPaymentId === pago.mpPaymentId
            return (
            <div key={pago.mpPaymentId} className="rounded-2xl p-5"
              style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: `1px solid ${usado ? 'rgba(248,113,113,0.3)' : 'rgba(0,255,136,0.2)'}`, opacity: usado ? 0.85 : 1 }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-2xl font-black" style={{ color: usado ? 'rgba(148,163,184,0.7)' : '#00ff88' }}>{ARS.format(pago.monto)}</div>
                  <div className="text-sm mt-1" style={{ color: 'rgba(226,232,240,0.85)' }}>{pago.nombrePagador || 'Sin nombre'}</div>
                  <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.55)' }}>
                    {fmtDate(pago.fechaPago)} · Billetera: <span style={{ color: 'rgba(0,212,255,0.75)' }}>{pago.billetera}</span>
                  </div>
                </div>
                {usado ? (
                  <span className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171' }}>
                    ✕ Ya usado
                  </span>
                ) : reclamando !== pago.mpPaymentId && (
                  <button onClick={() => abrirReclamo(pago.mpPaymentId)}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88', cursor: 'pointer' }}>
                    Reclamar pago
                  </button>
                )}
              </div>

              {usado && (
                <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid rgba(148,163,184,0.1)', color: 'rgba(248,113,113,0.85)' }}>
                  Este pago ya fue usado para validar {pago.ordenPropia ? <>tu orden <span className="font-bold">#{pago.ordenPropia}</span></> : 'otra orden'}. No se puede reclamar de nuevo.
                </div>
              )}

              {!usado && reclamando === pago.mpPaymentId && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <label style={labelStyle}>Número de orden</label>
                      <input style={inputStyle} value={ordenInput} autoFocus
                        onChange={e => { setOrdenInput(e.target.value); setConfirmacion(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') confirmarReclamo(pago) }}
                        placeholder="Ej: 67521" />
                    </div>
                    {!enConfirmacion && (
                      <button onClick={() => confirmarReclamo(pago)} disabled={enviandoReclamo}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: enviandoReclamo ? 'not-allowed' : 'pointer' }}>
                        {enviandoReclamo ? 'Validando…' : 'Confirmar'}
                      </button>
                    )}
                    <button onClick={() => { setReclamando(null); setConfirmacion(null) }} disabled={enviandoReclamo}
                      className="px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)', cursor: 'pointer' }}>
                      Cancelar
                    </button>
                  </div>

                  {/* La orden no existe → aviso + "Aceptar" (queda sujeto a confirmación del admin) */}
                  {enConfirmacion && (
                    <div className="mt-3 rounded-xl p-3.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <p className="text-xs leading-relaxed" style={{ color: '#fbbf24' }}>{confirmacion.message}</p>
                      <div className="mt-3">
                        <label style={labelStyle}>Concepto <span style={{ color: 'rgba(148,163,184,0.5)', fontWeight: 400 }}>(opcional)</span></label>
                        <ConceptoInput value={conceptoReclamo} onChange={setConceptoReclamo} qs={qs} notify={notify} style={inputStyle} />
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => aceptarAdjudicacion(pago)} disabled={enviandoReclamo}
                          className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', cursor: enviandoReclamo ? 'not-allowed' : 'pointer' }}>
                          {enviandoReclamo ? 'Enviando…' : 'Aceptar de todas formas'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* Historial de pagos reclamados */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.7)' }}>Mis pagos reclamados</h3>
        {loadingHist ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : historial.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Todavía no reclamaste pagos.</p>
        ) : (
          <div className="space-y-2">
            {historial.map(a => {
              const est = ESTADO_ADJ[a.estado]
              return (
                <div key={a.id} className="rounded-xl p-4"
                  style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: '#00d4ff' }}>{ARS.format(a.monto)}</span>
                      <span className="text-sm" style={{ color: 'rgba(226,232,240,0.8)' }}>{a.nombrePagador || 'Sin nombre'}</span>
                      {a.orderNumber && <span className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>· orden {a.orderNumber}</span>}
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide" style={est.style}>{est.txt}</span>
                  </div>
                  <div className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.5)' }}>{fmtDate(a.timestamp)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
