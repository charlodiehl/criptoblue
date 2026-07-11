'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Campo de tasa ARS/USDT con checkbox "Usar cotización estándar": al tildarlo,
// trae la cotización actual vía /api/finanzas/cotizacion y completa el campo
// (deshabilitando la edición manual). Reutilizable.
//
// sinMargen distingue el sentido del movimiento:
//   • false (default) → precio de venta Binance P2P + 0,75% (ingresos por órdenes)
//   • true            → precio de venta puro, +0% (reembolsos y pagos: no cobramos margen)
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void
  placeholder?: string
  disabled?: boolean
  // Trae el precio de venta sin el 0,75% (reembolsos y pagos).
  sinMargen?: boolean
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
}

export default function TasaInput({ label, value, onChange, notify, placeholder, disabled, sinMargen }: Props) {
  const [estandar, setEstandar] = useState(false)
  const [cargando, setCargando] = useState(false)

  async function toggle(checked: boolean) {
    if (disabled) return
    setEstandar(checked)
    if (!checked) return
    setCargando(true)
    try {
      const res = await fetch('/api/finanzas/cotizacion')
      const data = await res.json()
      // sinMargen usa el precio de venta puro (rateBase); el resto, con +0,75% (rate).
      const rate = sinMargen ? data.rateBase : data.rate
      if (!res.ok || !rate) throw new Error(data.error || 'No se pudo obtener la cotización')
      onChange(String(Math.round(Number(rate) * 100) / 100))
      notify(`Cotización estándar aplicada: ${Number(rate).toLocaleString('es-AR', { maximumFractionDigits: 2 })} ARS/USDT`, 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo obtener la cotización', 'error')
      setEstandar(false)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number" inputMode="decimal" min="0" step="0.0001"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Cuántos ARS = 1 USDT'}
        disabled={disabled || estandar || cargando}
        style={{ ...inputStyle, opacity: disabled || estandar ? 0.65 : 1, cursor: estandar ? 'not-allowed' : 'text' }}
      />
      <label className="flex items-center gap-2 mt-1.5 text-[11px]"
        style={{ color: 'rgba(0,212,255,0.75)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input type="checkbox" checked={estandar} disabled={disabled || cargando} onChange={e => toggle(e.target.checked)} />
        {cargando
          ? 'Obteniendo cotización…'
          : `Usar cotización estándar${sinMargen ? ' (P2P venta de Binance + 0%)' : ''}`}
      </label>
    </div>
  )
}
