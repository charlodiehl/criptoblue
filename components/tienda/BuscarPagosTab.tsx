'use client'

import { useState } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
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
  }

  async function confirmarReclamo(pago: PagoEncontrado) {
    if (enviandoReclamo) return
    if (!ordenInput.trim()) { notify('Ingresá el número de orden', 'error'); return }
    setEnviandoReclamo(true)
    try {
      const res = await fetch(`/api/tienda/reclamar${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId: pago.mpPaymentId, orderNumber: ordenInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(`Pago reclamado y orden #${data.orderNumber} marcada ✓`, 'success')
      // Sacar el pago reclamado de los resultados
      setResultado(r => r ? { ...r, pagos: r.pagos.filter(p => p.mpPaymentId !== pago.mpPaymentId) } : r)
      setReclamando(null)
      setOrdenInput('')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo reclamar', 'error')
    } finally {
      setEnviandoReclamo(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Formulario de búsqueda */}
      <form onSubmit={handleBuscar} className="rounded-2xl p-6"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
        <p className="text-xs mb-4" style={{ color: 'rgba(148,163,184,0.6)' }}>
          Buscá un pago que hayas recibido para reclamarlo. Los 3 datos son obligatorios: el monto debe coincidir exacto, el nombre puede ser parcial, y la fecha/hora puede diferir hasta 24 horas.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label style={labelStyle}>Nombre y apellido *</label>
            <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del que pagó" /></div>
          <div><label style={labelStyle}>Monto exacto *</label>
            <input type="number" min="0" step="0.01" style={inputStyle} value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" /></div>
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
          {resultado.pagos.map(pago => (
            <div key={pago.mpPaymentId} className="rounded-2xl p-5"
              style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,255,136,0.2)' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-2xl font-black" style={{ color: '#00ff88' }}>{ARS.format(pago.monto)}</div>
                  <div className="text-sm mt-1" style={{ color: 'rgba(226,232,240,0.85)' }}>{pago.nombrePagador || 'Sin nombre'}</div>
                  <div className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.55)' }}>
                    {fmtDate(pago.fechaPago)} · Billetera: <span style={{ color: 'rgba(0,212,255,0.75)' }}>{pago.billetera}</span>
                  </div>
                </div>
                {reclamando !== pago.mpPaymentId && (
                  <button onClick={() => abrirReclamo(pago.mpPaymentId)}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88', cursor: 'pointer' }}>
                    Reclamar pago
                  </button>
                )}
              </div>

              {reclamando === pago.mpPaymentId && (
                <div className="mt-4 pt-4 flex items-end gap-3 flex-wrap" style={{ borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                  <div className="flex-1 min-w-[160px]">
                    <label style={labelStyle}>Número de orden</label>
                    <input style={inputStyle} value={ordenInput} autoFocus
                      onChange={e => setOrdenInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmarReclamo(pago) }}
                      placeholder="Ej: 67521" />
                  </div>
                  <button onClick={() => confirmarReclamo(pago)} disabled={enviandoReclamo}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: enviandoReclamo ? 'not-allowed' : 'pointer' }}>
                    {enviandoReclamo ? 'Confirmando…' : 'Confirmar'}
                  </button>
                  <button onClick={() => setReclamando(null)} disabled={enviandoReclamo}
                    className="px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)', cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
