'use client'

import { useState } from 'react'
import type { Toast } from './TiendaPortal'

// Modal para descargar el registro (órdenes emparejadas) de un rango de fechas como
// Excel. Pide "desde" y "hasta"; siempre arma un .xlsx con la hoja "Ventas".
export default function DescargarRegistroModal({
  qs, fechaInicial, onClose, notify,
}: {
  qs: string
  fechaInicial: string   // 'YYYY-MM-DD' — prefill de desde/hasta (el día que está viendo)
  onClose: () => void
  notify: (msg: string, type?: Toast['type']) => void
}) {
  const [desde, setDesde] = useState(fechaInicial)
  const [hasta, setHasta] = useState(fechaInicial)
  const [bajando, setBajando] = useState(false)

  async function descargar() {
    if (bajando) return
    if (!desde || !hasta) { notify('Elegí las fechas desde y hasta', 'error'); return }
    if (desde > hasta) { notify('"Desde" no puede ser posterior a "hasta"', 'error'); return }
    setBajando(true)
    try {
      const sep = qs ? '&' : '?'
      const res = await fetch(`/api/tienda/registro-excel${qs}${sep}desde=${desde}&hasta=${hasta}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'No se pudo generar el Excel')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="(.+?)"/)
      a.download = m ? m[1] : `registro-${desde}_a_${hasta}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      notify('Registro descargado ✓', 'success')
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo descargar', 'error')
    } finally {
      setBajando(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: '14px', padding: '10px 12px', borderRadius: '10px', colorScheme: 'dark',
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.25)', color: 'rgba(226,232,240,0.92)', outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '440px', marginTop: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(0,212,255,0.9)' }}>Descargar registro</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.5)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.6)', marginBottom: '18px', lineHeight: 1.5 }}>
          Elegí el rango de días. Se arma un Excel con todas las órdenes emparejadas en la hoja <span style={{ color: 'rgba(0,212,255,0.75)' }}>Ventas</span>.
        </p>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Desde</label>
            <input type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Hasta</label>
            <input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <button onClick={descargar} disabled={bajando}
          style={{ width: '100%', padding: '12px', borderRadius: '11px', border: 'none', fontSize: '14px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #00d4ff, #0070f3)', boxShadow: '0 0 20px rgba(0,212,255,0.25)',
            cursor: bajando ? 'not-allowed' : 'pointer', opacity: bajando ? 0.6 : 1 }}>
          {bajando ? 'Generando Excel…' : '⬇ Descargar Excel'}
        </button>
      </div>
    </div>
  )
}
