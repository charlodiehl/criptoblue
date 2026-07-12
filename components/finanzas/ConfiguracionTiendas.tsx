'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Toast } from './FinanzasApp'

// Configuración de comisiones por tienda/billetera (solapa desplegable).

interface ComisionesData {
  tiendas: { storeId: string; storeName: string; pct: number }[]
  billeteras: { wallet: string; pct: number }[]
}
const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
}

interface Props {
  notify: (msg: string, type?: Toast['type']) => void
  onComisionGuardada: () => void   // refresca balances (el neto cambia con la comisión)
}

export default function ConfiguracionTiendas({ notify, onComisionGuardada }: Props) {
  const [configOpen, setConfigOpen] = useState(false)
  const [comisiones, setComisiones] = useState<ComisionesData | null>(null)
  const [selEntity, setSelEntity] = useState('')   // 'tienda:<storeId>' | 'billetera:<wallet>'
  const [pctInput, setPctInput] = useState('')
  const [savingCom, setSavingCom] = useState(false)

  const fetchComisiones = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/comisiones')
      if (res.ok) setComisiones(await res.json())
    } catch { /* silencioso */ }
  }, [])
  useEffect(() => { fetchComisiones() }, [fetchComisiones])

  function onSelectEntity(v: string) {
    setSelEntity(v)
    if (!v || !comisiones) { setPctInput(''); return }
    const [tipo, id] = v.split(':')
    const pct = tipo === 'tienda'
      ? comisiones.tiendas.find(t => t.storeId === id)?.pct
      : comisiones.billeteras.find(b => b.wallet === id)?.pct
    setPctInput(pct != null ? String(pct) : '')
  }

  async function guardarComision() {
    if (!selEntity || savingCom) return
    const pct = Number(pctInput.replace(',', '.'))
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { notify('Porcentaje inválido (0 a 100)', 'error'); return }
    const [tipo, id] = selEntity.split(':')
    setSavingCom(true)
    try {
      const res = await fetch('/api/finanzas/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, id, pct }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify('Comisión guardada ✓', 'success')
      await fetchComisiones()
      onComisionGuardada()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setSavingCom(false)
    }
  }

  return (
    <section>
      <button onClick={() => setConfigOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3 sm:px-4 py-3 text-[13px] sm:text-sm font-semibold transition-all"
        style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', color: '#00d4ff', cursor: 'pointer' }}>
        <span className="flex items-center gap-2 min-w-0 text-left">
          <span className="shrink-0">⚙️</span>
          <span>Configuración de Tiendas y billeteras</span>
        </span>
        <span className="shrink-0" style={{ fontSize: '10px' }}>{configOpen ? '▲' : '▼'}</span>
      </button>
      {configOpen && (
        <div className="mt-3 rounded-xl p-3 sm:p-4 space-y-4"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
          <div>
            <label style={labelStyle}>Tienda o billetera</label>
            <select value={selEntity} onChange={e => onSelectEntity(e.target.value)} disabled={!comisiones}
              style={{ ...inputStyle, colorScheme: 'dark', cursor: comisiones ? 'pointer' : 'wait', opacity: comisiones ? 1 : 0.6 }}>
              {!comisiones ? (
                <option value="" style={optionStyle}>Cargando…</option>
              ) : (
                <>
                  <option value="" style={optionStyle}>Seleccioná una entidad…</option>
                  <optgroup label="Tiendas" style={optionStyle}>
                    {comisiones.tiendas.map(t => (
                      <option key={t.storeId} value={`tienda:${t.storeId}`} style={optionStyle}>{t.storeName} · ID {t.storeId}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Billeteras" style={optionStyle}>
                    {comisiones.billeteras.map(b => (
                      <option key={b.wallet} value={`billetera:${b.wallet}`} style={optionStyle}>{b.wallet}</option>
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>

          {selEntity && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1" style={{ minWidth: '120px' }}>
                <label style={labelStyle}>Comisión (%)</label>
                <input type="number" inputMode="decimal" min="0" max="100" step="0.1" value={pctInput}
                  onChange={e => setPctInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') guardarComision() }}
                  style={inputStyle} />
              </div>
              <button onClick={guardarComision} disabled={savingCom}
                className="rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50 w-full sm:w-auto"
                style={{ padding: '11px 20px', background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: savingCom ? 'not-allowed' : 'pointer' }}>
                {savingCom ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}

          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(148,163,184,0.5)' }}>
            La comisión se descuenta de los ingresos (órdenes de la tienda / pagos de la billetera) y se refleja en el saldo neto de toda la app.
            Valores por defecto: tiendas 3,5% · billeteras 1%.
          </p>
        </div>
      )}
    </section>
  )
}
