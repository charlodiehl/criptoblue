'use client'

import { useState } from 'react'
import MontoInput from '@/components/MontoInput'

// Edición de un movimiento del extracto (tienda o billetera): fecha/hora, concepto,
// monto ARS y tasa. El backend sincroniza las tablas ligadas. Solo admin.

export interface MovimientoEditable {
  fuente: 'balance' | 'wallet' | 'refund'
  id: number
  fechaISO: string          // fecha actual del movimiento (para prellenar)
  concepto: string
  montoArs: number          // valor absoluto mostrado
  tasa: number | null       // cotización actual (usdt_rate / cotización)
  puedeMontoTasa: boolean   // false para transferencias (multi-moneda): solo fecha/concepto
  tasaLabel?: string        // ej. "ARS/USDT" o "ARS por 1 USD"
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}

// ISO → "YYYY-MM-DDTHH:mm" en hora Argentina (para el input datetime-local).
function artLocal(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export default function EditarMovimientoModal({
  mov, onCerrar, onGuardado, notify,
}: {
  mov: MovimientoEditable
  onCerrar: () => void
  onGuardado: () => void
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [fecha, setFecha] = useState(artLocal(mov.fechaISO))
  const [concepto, setConcepto] = useState(mov.concepto)
  const [monto, setMonto] = useState(String(mov.montoArs))
  const [tasa, setTasa] = useState(mov.tasa != null ? String(mov.tasa) : '')
  const [guardando, setGuardando] = useState(false)

  const fechaOriginal = artLocal(mov.fechaISO)
  const usdtPrevisto = mov.puedeMontoTasa && Number(tasa.replace(',', '.')) > 0
    ? Number(monto.replace(',', '.')) / Number(tasa.replace(',', '.')) : null

  async function guardar() {
    if (guardando) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = { fuente: mov.fuente, id: mov.id }
    if (fecha && fecha !== fechaOriginal) body.fecha = fecha
    if (concepto !== mov.concepto) body.concepto = concepto
    if (mov.puedeMontoTasa) {
      const m = Number(monto.replace(',', '.'))
      if (!Number.isFinite(m) || m <= 0) { notify('El monto debe ser mayor a 0', 'error'); return }
      if (Math.abs(m - mov.montoArs) > 0.005) body.montoArs = m
      const tStr = tasa.replace(',', '.').trim()   // tasa opcional (los retiros en ARS no llevan)
      if (tStr !== '') {
        const t = Number(tStr)
        if (!Number.isFinite(t) || t <= 0) { notify('La tasa debe ser mayor a 0', 'error'); return }
        if (mov.tasa == null || Math.abs(t - mov.tasa) > 1e-9) body.tasa = t
      }
    }
    if (Object.keys(body).length <= 2) { notify('No cambiaste nada', 'info'); return }

    setGuardando(true)
    try {
      const res = await fetch('/api/finanzas/movimiento/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(data.aviso || 'Movimiento actualizado ✓', data.aviso ? 'info' : 'success')
      onGuardado()
      onCerrar()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onCerrar}>
      <div className="rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: '#00d4ff' }}>Editar movimiento</h3>
          <button onClick={onCerrar} className="text-xl leading-none" style={{ color: 'rgba(148,163,184,0.7)' }}>×</button>
        </div>

        <div>
          <label style={labelStyle}>Fecha y hora</label>
          <input type="datetime-local" style={{ ...inputStyle, colorScheme: 'dark' }} value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>Concepto</label>
          <input style={inputStyle} value={concepto} onChange={e => setConcepto(e.target.value)} />
        </div>

        {mov.puedeMontoTasa ? (
          <>
            <div>
              <label style={labelStyle}>Monto (ARS)</label>
              <MontoInput style={inputStyle} value={monto} onChange={setMonto} placeholder="0,00" />
            </div>
            <div>
              <label style={labelStyle}>Tasa {mov.tasaLabel ? `(${mov.tasaLabel})` : ''}</label>
              <MontoInput style={inputStyle} value={tasa} onChange={setTasa} placeholder="0,00" />
              {usdtPrevisto != null && (
                <p className="text-[11px] mt-1.5" style={{ color: '#fbbf24' }}>
                  Equivale a <span className="font-bold">{usdtPrevisto.toLocaleString('es-AR', { maximumFractionDigits: 2 })} USDT</span> · al guardar se recalcula el saldo.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}>
            Esta es una transferencia: acá solo se editan fecha y concepto. El monto/tasa se maneja aparte por su moneda.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onCerrar} className="rounded-lg px-4 py-2 text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)' }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
