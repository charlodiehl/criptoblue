'use client'

import { useState, useRef } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import { parseMonto } from '@/lib/cargar-pagos'

// ISO AR (-03:00) ⇄ valor de <input type="datetime-local"> ('YYYY-MM-DDTHH:mm')
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]}T${m[2]}` : ''
}
function localInputToISO(local: string): string {
  return local ? `${local}:00.000-03:00` : ''
}

const editInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '5px 8px', borderRadius: '6px',
  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,212,255,0.2)', color: 'white', outline: 'none', colorScheme: 'dark',
}
const editLabelStyle: React.CSSProperties = {
  fontSize: '9px', color: 'rgba(148,163,184,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '2px',
}

interface PagoPreview {
  fila: number
  nombre: string
  monto: number | null
  fecha: string | null
  cuit: string
  email: string
  orden: string
  referencia: string
  warnings: string[]
}

type PagoCampo = 'nombre' | 'monto' | 'fecha' | 'cuit' | 'email' | 'orden' | 'referencia'

interface PreviewResp {
  headers: string[]
  mapping: Partial<Record<PagoCampo, number>>
  headerCampo: (PagoCampo | null)[]
  unmapped: string[]
  totalFilas: number
  payments: PagoPreview[]
  yaCargados: number
  retiros: number
  sinFecha: number
  sinMonto: number
}

const CAMPO_LABEL: Record<PagoCampo, string> = {
  nombre: 'Nombre', monto: 'Monto', fecha: 'Fecha', cuit: 'CUIT/DNI',
  email: 'Email', orden: 'Orden', referencia: 'Referencia',
}

export default function CargarPagosModal({ onClose, onCargado }: {
  onClose: () => void
  onCargado: (msg: string) => void
}) {
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [cargando, setCargando] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Copia editable de los pagos del preview (para corregir a mano antes de cargar)
  const [rows, setRows] = useState<PagoPreview[]>([])
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ monto: string; nombre: string; fechaLocal: string }>({ monto: '', nombre: '', fechaLocal: '' })

  const startEdit = (i: number) => {
    const p = rows[i]
    setDraft({ monto: p.monto !== null ? String(p.monto) : '', nombre: p.nombre, fechaLocal: isoToLocalInput(p.fecha) })
    setEditIdx(i)
  }
  const saveEdit = (i: number) => {
    const monto = parseMonto(draft.monto)
    const fecha = draft.fechaLocal ? localInputToISO(draft.fechaLocal) : null
    const warnings: string[] = []
    if (monto === null) warnings.push('monto inválido o ausente')
    if (!fecha) warnings.push('fecha inválida o ausente')
    setRows(rs => rs.map((p, idx) => idx === i ? { ...p, monto, nombre: draft.nombre.trim(), fecha, warnings } : p))
    setEditIdx(null)
  }

  const onFile = async (file: File) => {
    setError(null); setPreview(null); setFileName(file.name); setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/cargar-pagos/preview', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'No se pudo leer el archivo'); return }
      setPreview(data)
      setRows(data.payments || [])
      setEditIdx(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const validos = rows.filter(p => p.monto !== null && p.fecha)

  const confirmar = async () => {
    if (validos.length === 0) { setError('No hay pagos válidos para cargar (faltan monto o fecha)'); return }
    setCargando(true); setError(null)
    try {
      const res = await fetch('/api/cargar-pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments: validos }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error al cargar los pagos'); return }
      const partes = [`📥 ${data.added} pago${data.added !== 1 ? 's' : ''} cargado${data.added !== 1 ? 's' : ''}`]
      if (data.duplicates) partes.push(`${data.duplicates} ya estaba${data.duplicates !== 1 ? 'n' : ''}`)
      if (data.skipped) partes.push(`${data.skipped} omitido${data.skipped !== 1 ? 's' : ''}`)
      onCargado(partes.join(' · '))
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setCargando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(880px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: '#0d1117', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '16px', padding: '24px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'white', margin: 0 }}>📥 Cargar pagos desde Excel</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.5)', fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Selector de archivo */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
          style={{ border: `1.5px dashed ${dragOver ? 'rgba(0,212,255,0.6)' : 'rgba(0,212,255,0.3)'}`, borderRadius: '12px', padding: '22px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(0,212,255,0.08)' : 'rgba(0,212,255,0.03)', marginBottom: '16px' }}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
          <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.8)', margin: '0 0 4px' }}>
            {fileName ? `📄 ${fileName}` : 'Arrastrá un Excel acá o hacé clic para elegir'}
          </p>
          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', margin: 0 }}>.xlsx · .xls · .csv</p>
        </div>

        {loading && <p style={{ fontSize: '13px', color: 'rgba(0,212,255,0.7)' }}>Leyendo archivo…</p>}
        {error && (
          <div style={{ padding: '10px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: '8px', color: '#f87171', fontSize: '12px', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        {preview && (
          <>
            {/* Columnas detectadas */}
            <div style={{ marginBottom: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)', marginBottom: '8px' }}>
                Columnas detectadas
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {preview.headers.map((h, i) => {
                  const campo = preview.headerCampo[i]
                  return (
                    <span key={i} style={{ fontSize: '11px', padding: '4px 9px', borderRadius: '7px', border: `1px solid ${campo ? 'rgba(0,255,136,0.3)' : 'rgba(148,163,184,0.18)'}`, background: campo ? 'rgba(0,255,136,0.06)' : 'transparent', color: campo ? '#00ff88' : 'rgba(148,163,184,0.4)' }}>
                      {h || '(vacío)'}{campo ? ` → ${CAMPO_LABEL[campo]}` : ' · ignorada'}
                    </span>
                  )
                })}
              </div>
              {preview.mapping.monto === undefined && (
                <p style={{ fontSize: '11px', color: '#f87171', marginTop: '8px' }}>
                  ⚠ No se detectó columna de <b>Monto</b> — sin eso no se puede cargar.
                </p>
              )}
            </div>

            {/* Resumen */}
            <p style={{ fontSize: '12px', color: 'rgba(226,232,240,0.7)', marginBottom: '10px' }}>
              <b style={{ color: validos.length > 0 ? '#00ff88' : 'rgba(226,232,240,0.7)' }}>{validos.length}</b> pago{validos.length !== 1 ? 's' : ''} nuevo{validos.length !== 1 ? 's' : ''} a cargar de {preview.totalFilas} fila{preview.totalFilas !== 1 ? 's' : ''}
              {preview.yaCargados > 0 && <span style={{ color: 'rgba(0,212,255,0.7)' }}> · {preview.yaCargados} ya cargado{preview.yaCargados !== 1 ? 's' : ''} (omitido{preview.yaCargados !== 1 ? 's' : ''})</span>}
              {preview.retiros > 0 && <span style={{ color: 'rgba(148,163,184,0.55)' }}> · {preview.retiros} retiro{preview.retiros !== 1 ? 's' : ''}/comisión descartado{preview.retiros !== 1 ? 's' : ''}</span>}
              {preview.sinFecha > 0 && <span style={{ color: 'rgba(148,163,184,0.55)' }}> · {preview.sinFecha} sin fecha (totales)</span>}
            </p>

            {/* Vista previa de tarjetas */}
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)', marginBottom: '8px' }}>
              Vista previa
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '8px', marginBottom: '14px' }}>
              {rows.slice(0, 60).map((p, i) => (
                <div key={i} style={{ background: 'linear-gradient(160deg,#0d1117,#0f1824)', border: `1px solid ${editIdx === i ? 'rgba(0,212,255,0.45)' : p.warnings.length ? 'rgba(255,180,0,0.3)' : 'rgba(0,212,255,0.1)'}`, borderRadius: '12px', padding: '12px 14px' }}>
                  {editIdx === i ? (
                    /* Modo edición inline */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                      <div>
                        <label style={editLabelStyle}>Monto</label>
                        <input style={editInputStyle} value={draft.monto} autoFocus
                          onChange={e => setDraft(d => ({ ...d, monto: e.target.value }))} />
                      </div>
                      <div>
                        <label style={editLabelStyle}>Nombre</label>
                        <input style={editInputStyle} value={draft.nombre}
                          onChange={e => setDraft(d => ({ ...d, nombre: e.target.value }))} />
                      </div>
                      <div>
                        <label style={editLabelStyle}>Fecha y hora</label>
                        <input type="datetime-local" style={editInputStyle} value={draft.fechaLocal}
                          onChange={e => setDraft(d => ({ ...d, fechaLocal: e.target.value }))} />
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                        <button onClick={() => saveEdit(i)}
                          style={{ fontSize: '11px', fontWeight: 700, padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(0,255,136,0.35)', background: 'rgba(0,255,136,0.1)', color: '#00ff88', cursor: 'pointer' }}>
                          ✓ Guardar
                        </button>
                        <button onClick={() => setEditIdx(null)}
                          style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(148,163,184,0.5)', cursor: 'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Vista normal */
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                        <p style={{ fontSize: '17px', fontWeight: 800, color: p.monto !== null ? 'white' : 'rgba(248,113,113,0.85)', margin: '0 0 4px' }}>
                          {p.monto !== null ? ARS.format(p.monto) : 'sin monto'}
                        </p>
                        <button onClick={() => startEdit(i)} title="Editar"
                          style={{ background: 'none', border: 'none', color: 'rgba(0,212,255,0.55)', cursor: 'pointer', fontSize: '13px', padding: '2px 2px 2px 6px', lineHeight: 1, flexShrink: 0 }}>
                          ✎
                        </button>
                      </div>
                      {p.cuit && <p style={{ fontSize: '10px', color: 'rgba(0,212,255,0.6)', fontWeight: 600, margin: '0 0 2px' }}>CUIT/DNI: {p.cuit}</p>}
                      <p style={{ fontSize: '12px', color: 'rgba(226,232,240,0.8)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre || 'Sin nombre'}</p>
                      <p style={{ fontSize: '10px', color: 'rgba(148,163,184,0.45)', margin: '0 0 2px' }}>{p.fecha ? fmtDate(p.fecha) : 'sin fecha'}</p>
                      {p.orden && <p style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', margin: 0 }}>Orden: {p.orden}</p>}
                      {p.warnings.length > 0 && <p style={{ fontSize: '10px', color: 'rgba(255,180,0,0.75)', marginTop: '4px' }}>⚠ {p.warnings.join(' · ')}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
            {rows.length > 60 && (
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', marginBottom: '14px' }}>… y {rows.length - 60} más (se cargarán todos los válidos)</p>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px' }}>
              <button onClick={onClose} style={{ fontSize: '12px', padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(148,163,184,0.6)', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={confirmar} disabled={cargando || validos.length === 0}
                style={{ fontSize: '12px', fontWeight: 700, padding: '8px 18px', borderRadius: '8px', border: '1px solid rgba(0,255,136,0.35)', background: 'rgba(0,255,136,0.1)', color: '#00ff88', cursor: (cargando || validos.length === 0) ? 'not-allowed' : 'pointer', opacity: (cargando || validos.length === 0) ? 0.4 : 1 }}>
                {cargando ? 'Cargando…' : `✓ Cargar ${validos.length} pago${validos.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
