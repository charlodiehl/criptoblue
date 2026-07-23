'use client'

import { useState, useEffect, useCallback } from 'react'

// Desplegable de concepto para una tienda. Opciones: "(sin concepto)" + los conceptos
// guardados (LRU, máx 10) + "Añadir nuevo concepto" (abre un input). Al guardar uno nuevo
// entra a la lista y queda seleccionado. `qs` scopea la tienda (admin / multi-acceso).
// Es opcional: dejar "(sin concepto)" (value = '') usa el default del tipo de movimiento.

const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }

export default function ConceptoInput({
  value, onChange, qs, notify, style, disabled,
}: {
  value: string
  onChange: (concepto: string) => void
  qs: string
  notify?: (msg: string, type?: 'success' | 'error' | 'info') => void
  style?: React.CSSProperties
  disabled?: boolean
}) {
  const [conceptos, setConceptos] = useState<string[]>([])
  const [modo, setModo] = useState<'select' | 'nuevo'>('select')
  const [nuevo, setNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(`/api/tienda/conceptos${qs}`)
      if (res.ok) setConceptos((await res.json()).conceptos || [])
    } catch { /* la lista es secundaria; el desplegable funciona igual */ }
  }, [qs])
  useEffect(() => { fetchList() }, [fetchList])

  async function guardarNuevo() {
    const nombre = nuevo.trim()
    if (!nombre) { setModo('select'); return }
    setGuardando(true)
    try {
      const res = await fetch(`/api/tienda/conceptos${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setConceptos(data.conceptos || [])
      onChange(nombre)        // dejarlo seleccionado
      setModo('select')
      setNuevo('')
    } catch (e) {
      notify?.(e instanceof Error ? e.message : 'No se pudo guardar el concepto', 'error')
    } finally {
      setGuardando(false)
    }
  }

  if (modo === 'nuevo') {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={40} disabled={guardando}
          placeholder="Nombre del concepto (ej: Impuestos)" style={style}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarNuevo() } if (e.key === 'Escape') setModo('select') }}
        />
        <button type="button" onClick={guardarNuevo} disabled={guardando || !nuevo.trim()}
          className="rounded-lg px-3 py-2 text-xs font-bold text-white transition-all disabled:opacity-50 shrink-0"
          style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: guardando ? 'wait' : 'pointer' }}>
          {guardando ? '…' : 'Guardar'}
        </button>
        <button type="button" onClick={() => { setModo('select'); setNuevo('') }} disabled={guardando}
          className="rounded-lg px-3 py-2 text-xs font-medium transition-all shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)' }}>
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <select
      value={conceptos.includes(value) ? value : ''}
      disabled={disabled}
      onChange={e => { const v = e.target.value; if (v === '__nuevo__') { setModo('nuevo'); setNuevo('') } else onChange(v) }}
      style={{ ...style, colorScheme: 'dark', cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <option value="" style={optionStyle}>(sin concepto)</option>
      {conceptos.map(c => <option key={c} value={c} style={optionStyle}>{c}</option>)}
      <option value="__nuevo__" style={optionStyle}>➕ Añadir nuevo concepto</option>
    </select>
  )
}
