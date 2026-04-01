'use client'

import { useState, useMemo } from 'react'
import type { LogEntry } from '@/lib/types'
import { PAYMENT_SOURCE_NAMES } from '@/lib/config'
import { fmtDate } from '@/lib/utils'

function fmtMontoDisplay(n: number) {
  // Sin separador de miles, punto decimal (igual que el export TSV)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

// Para el TSV: punto como decimal, sin separador de miles → Google Sheets lo interpreta correctamente
function fmtMontoTSV(n: number) {
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function fmtCuit(s: string) {
  return (s || '').replace(/\D/g, '')
}

function billetera(entry: LogEntry): string {
  const source = entry.payment?.source
  if (source && PAYMENT_SOURCE_NAMES[source]) return PAYMENT_SOURCE_NAMES[source]
  return source || 'MercadoPago'
}

function nombrePagador(entry: LogEntry): string {
  return entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || ''
}

type SortKey = 'fecha' | 'monto' | 'cuit' | 'nombre' | 'tienda' | 'orden' | 'billetera'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

interface Props {
  entries: LogEntry[]
  onClearLog?: () => void
  onEntryEdited?: () => void
}

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: 'Fecha y hora',      key: 'fecha'     },
  { label: 'Monto',             key: 'monto'     },
  { label: 'CUIT/CUIL/DNI',     key: 'cuit'      },
  { label: 'Nombre y apellido', key: 'nombre'    },
  { label: 'Tienda',            key: 'tienda'    },
  { label: 'Número de orden',   key: 'orden'     },
  { label: 'Billetera',         key: 'billetera' },
]

const HEADERS = COLUMNS.map(c => c.label)

function getSortValue(e: LogEntry, key: SortKey): string | number {
  switch (key) {
    case 'fecha':     return new Date(e.payment?.fechaPago || e.timestamp).getTime()
    case 'monto':     return e.payment?.monto ?? e.amount ?? 0
    case 'cuit':      return Number(fmtCuit(e.payment?.cuitPagador || '')) || 0
    case 'nombre':    return nombrePagador(e).toLowerCase()
    case 'tienda':    return (e.storeName || e.order?.storeName || '').toLowerCase()
    case 'orden':     return Number((e.orderNumber || e.order?.orderNumber || '').replace(/\D/g, '')) || 0
    case 'billetera': return billetera(e).toLowerCase()
  }
}

// Default first-click direction per column
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  fecha:     'desc',
  monto:     'desc',
  cuit:      'desc',
  nombre:    'asc',
  tienda:    'asc',
  orden:     'desc',
  billetera: 'asc',
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,212,255,0.05)',
  border: '1px solid rgba(0,212,255,0.35)',
  borderRadius: '6px',
  color: 'rgba(226,232,240,0.9)',
  fontSize: '13px',
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
  minWidth: '100px',
}

export default function RegistroTab({ entries, onClearLog, onEntryEdited }: Props) {
  const [copied, setCopied] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [markingCopied, setMarkingCopied] = useState(false)

  // Inline edit state
  const [editingTs, setEditingTs] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCuit, setEditCuit] = useState('')
  const [editOrderNumber, setEditOrderNumber] = useState('')
  const [editStoreName, setEditStoreName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const handleClear = async () => {
    if (!confirm('¿Borrar todo el registro? Esta acción no se puede deshacer.')) return
    setClearing(true)
    try {
      await onClearLog?.()
    } finally {
      setClearing(false)
    }
  }
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  const newCount = useMemo(() => entries.filter(e =>
    (e.action === 'manual_paid' || e.action === 'auto_paid') && !e.copiedAt
  ).length, [entries])

  const copiedCount = useMemo(() => entries.filter(e =>
    (e.action === 'manual_paid' || e.action === 'auto_paid') && !!e.copiedAt
  ).length, [entries])

  const paid = useMemo(() => {
    const filtered = entries.filter(e => e.action === 'manual_paid' || e.action === 'auto_paid' || e.action === 'no_match')
    return filtered.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      let cmp = 0
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
      else cmp = String(va).localeCompare(String(vb), 'es-AR')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [entries, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(paid.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = paid.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_DIR[key])
    }
    setPage(1)
  }

  const handleCopy = async () => {
    const newEntries = paid.filter(e => !e.copiedAt)
    if (newEntries.length === 0) return

    const rows = newEntries.map(e => [
      fmtDate(e.payment?.fechaPago || e.timestamp),
      fmtMontoTSV(e.payment?.monto ?? e.amount ?? 0),
      fmtCuit(e.payment?.cuitPagador || ''),
      nombrePagador(e),
      e.storeName || e.order?.storeName || '',
      (e.orderNumber || e.order?.orderNumber || '').replace(/^#/, ''),
      billetera(e),
    ])

    const tsv = rows.map(r => r.join('\t')).join('\n')
    await navigator.clipboard.writeText(tsv)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)

    // Marcar como copiadas en Supabase
    setMarkingCopied(true)
    try {
      await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_copied', timestamps: newEntries.map(e => e.timestamp) }),
      })
      onEntryEdited?.()
    } finally {
      setMarkingCopied(false)
    }
  }

  const startEdit = (e: LogEntry) => {
    setEditingTs(e.timestamp)
    setEditName(nombrePagador(e))
    setEditCuit(fmtCuit(e.payment?.cuitPagador || ''))
    setEditOrderNumber(e.orderNumber || e.order?.orderNumber || '')
    setEditStoreName(e.storeName || e.order?.storeName || '')
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingTs(null)
    setEditError(null)
  }

  const saveEdit = async (timestamp: string) => {
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, customerName: editName, cuit: editCuit, orderNumber: editOrderNumber, storeName: editStoreName }),
      })
      if (!res.ok) {
        const data = await res.json()
        setEditError(data.error || 'Error al guardar')
        return
      }
      setEditingTs(null)
      onEntryEdited?.()
    } catch {
      setEditError('Error de red')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
          {paid.length} emparejamiento{paid.length !== 1 ? 's' : ''}
          {newCount > 0 && (
            <span style={{ marginLeft: '8px', color: 'rgba(226,232,240,0.75)', fontWeight: 600 }}>
              · {newCount} nuevo{newCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={handleCopy}
            disabled={newCount === 0 || markingCopied}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '10px',
              border: copied ? '1px solid rgba(0,255,136,0.4)' : '1px solid rgba(0,212,255,0.25)',
              background: copied ? 'rgba(0,255,136,0.08)' : 'rgba(0,212,255,0.06)',
              color: copied ? '#00ff88' : '#00d4ff',
              cursor: newCount === 0 || markingCopied ? 'not-allowed' : 'pointer',
              opacity: newCount === 0 || markingCopied ? 0.4 : 1, transition: 'all 0.2s',
            }}
          >
            {copied ? '✓ Copiado' : '⧉ Copiar nuevos registros'}
          </button>
          <button
            onClick={handleClear}
            disabled={paid.length === 0 || clearing}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '10px',
              border: '1px solid rgba(255,70,70,0.3)',
              background: 'rgba(255,70,70,0.06)',
              color: 'rgba(255,100,100,0.8)',
              cursor: paid.length === 0 || clearing ? 'not-allowed' : 'pointer',
              opacity: paid.length === 0 || clearing ? 0.4 : 1, transition: 'all 0.2s',
            }}
          >
            {clearing ? 'Borrando...' : '🗑 Borrar registro'}
          </button>
        </div>
      </div>

      {paid.length === 0 ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '16px', padding: '64px 0',
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.08)',
          }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>No hay emparejamientos registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {COLUMNS.map(col => {
                  const active = sortKey === col.key
                  const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        textAlign: 'left',
                        padding: '10px 14px',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: active ? 'rgba(0,212,255,0.9)' : 'rgba(0,212,255,0.5)',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {col.label}{arrow}
                    </th>
                  )
                })}
                {/* Columna de edición — sin encabezado */}
                <th style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', width: '42px' }} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e, i) => {
                const isEditing = editingTs === e.timestamp
                const isNew = !e.copiedAt
                const fecha = fmtDate(e.payment?.fechaPago || e.timestamp)
                const monto = fmtMontoDisplay(e.payment?.monto ?? e.amount ?? 0)
                const cuit = fmtCuit(e.payment?.cuitPagador || '')
                const nombre = nombrePagador(e)
                const tienda = e.storeName || e.order?.storeName || '—'
                const orden = e.orderNumber || e.order?.orderNumber || '—'
                const bill = billetera(e)

                return (
                  <tr
                    key={`${e.mpPaymentId}-${i}`}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: isEditing
                        ? 'rgba(0,212,255,0.04)'
                        : i % 2 === 0 ? 'transparent' : 'rgba(0,212,255,0.015)',
                      opacity: isNew ? 1 : 0.45,
                    }}
                  >
                    {/* Fecha — siempre readonly */}
                    <td style={{ padding: '12px 14px', color: isNew ? 'rgba(148,163,184,0.9)' : 'rgba(148,163,184,0.6)', fontWeight: isNew ? 700 : 400, whiteSpace: 'nowrap' }}>{fecha}</td>

                    {/* Monto — siempre readonly */}
                    <td style={{ padding: '12px 14px', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>{monto}</td>

                    {/* CUIT — editable */}
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(0,212,255,0.95)' : 'rgba(0,212,255,0.7)', fontWeight: isNew ? 700 : 400, fontFamily: 'monospace' }}>
                      {isEditing ? (
                        <input
                          value={editCuit}
                          onChange={ev => setEditCuit(ev.target.value.replace(/\D/g, ''))}
                          placeholder="CUIT sin guiones"
                          maxLength={11}
                          style={{ ...inputStyle, fontFamily: 'monospace', color: 'rgba(0,212,255,0.9)' }}
                          onKeyDown={ev => {
                            if (ev.key === 'Enter') saveEdit(e.timestamp)
                            if (ev.key === 'Escape') cancelEdit()
                          }}
                        />
                      ) : (
                        cuit || '—'
                      )}
                    </td>

                    {/* Nombre — editable */}
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(226,232,240,0.95)' : 'rgba(226,232,240,0.85)', fontWeight: isNew ? 700 : 400, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input
                          value={editName}
                          onChange={ev => setEditName(ev.target.value)}
                          placeholder="Nombre y apellido"
                          autoFocus
                          style={inputStyle}
                          onKeyDown={ev => {
                            if (ev.key === 'Enter') saveEdit(e.timestamp)
                            if (ev.key === 'Escape') cancelEdit()
                          }}
                        />
                      ) : (
                        nombre || '—'
                      )}
                    </td>

                    {/* Tienda — editable */}
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(148,163,184,0.8)' : 'rgba(148,163,184,0.5)', fontWeight: isNew ? 700 : 400, whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input
                          value={editStoreName}
                          onChange={ev => setEditStoreName(ev.target.value)}
                          placeholder="Nombre de la tienda"
                          style={{ ...inputStyle, color: 'rgba(148,163,184,0.8)' }}
                          onKeyDown={ev => {
                            if (ev.key === 'Enter') saveEdit(e.timestamp)
                            if (ev.key === 'Escape') cancelEdit()
                          }}
                        />
                      ) : (
                        tienda
                      )}
                    </td>

                    {/* Orden — editable */}
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: '#00d4ff', fontWeight: 700, whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input
                          value={editOrderNumber}
                          onChange={ev => setEditOrderNumber(ev.target.value)}
                          placeholder="Número de orden"
                          style={{ ...inputStyle, color: '#00d4ff', fontWeight: 600 }}
                          onKeyDown={ev => {
                            if (ev.key === 'Enter') saveEdit(e.timestamp)
                            if (ev.key === 'Escape') cancelEdit()
                          }}
                        />
                      ) : (
                        orden
                      )}
                    </td>

                    {/* Billetera — siempre readonly */}
                    <td style={{ padding: '12px 14px', color: isNew ? 'rgba(148,163,184,0.7)' : 'rgba(148,163,184,0.4)', fontWeight: isNew ? 700 : 400, whiteSpace: 'nowrap' }}>{bill}</td>

                    {/* Botones de acción */}
                    <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            onClick={() => saveEdit(e.timestamp)}
                            disabled={editSaving}
                            title="Guardar"
                            style={{
                              width: '26px', height: '26px', borderRadius: '6px',
                              border: '1px solid rgba(0,255,136,0.4)',
                              background: 'rgba(0,255,136,0.08)',
                              color: '#00ff88',
                              fontSize: '13px', cursor: editSaving ? 'not-allowed' : 'pointer',
                              opacity: editSaving ? 0.5 : 1,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            ✓
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={editSaving}
                            title="Cancelar"
                            style={{
                              width: '26px', height: '26px', borderRadius: '6px',
                              border: '1px solid rgba(255,70,70,0.3)',
                              background: 'rgba(255,70,70,0.06)',
                              color: 'rgba(255,100,100,0.8)',
                              fontSize: '13px', cursor: editSaving ? 'not-allowed' : 'pointer',
                              opacity: editSaving ? 0.5 : 1,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(e)}
                          title="Editar nombre y CUIT"
                          style={{
                            width: '26px', height: '26px', borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.07)',
                            background: 'transparent',
                            color: 'rgba(148,163,184,0.35)',
                            fontSize: '13px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={ev => {
                            const btn = ev.currentTarget
                            btn.style.color = 'rgba(0,212,255,0.7)'
                            btn.style.borderColor = 'rgba(0,212,255,0.3)'
                            btn.style.background = 'rgba(0,212,255,0.06)'
                          }}
                          onMouseLeave={ev => {
                            const btn = ev.currentTarget
                            btn.style.color = 'rgba(148,163,184,0.35)'
                            btn.style.borderColor = 'rgba(255,255,255,0.07)'
                            btn.style.background = 'transparent'
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Error de edición */}
          {editError && (
            <div style={{ padding: '8px 14px', color: 'rgba(255,100,100,0.8)', fontSize: '12px' }}>
              ⚠ {editError}
            </div>
          )}

          {/* Paginador */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', padding: '20px 0 4px' }}>
              {/* Anterior */}
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent',
                  color: safePage === 1 ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.5)',
                  fontSize: '13px',
                  cursor: safePage === 1 ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ‹
              </button>

              {/* Números de página */}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => {
                const isActive = n === safePage
                return (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    style={{
                      minWidth: '34px',
                      padding: '6px 4px',
                      borderRadius: '8px',
                      border: isActive ? '1px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
                      background: isActive ? 'rgba(0,212,255,0.1)' : 'transparent',
                      color: isActive ? '#00d4ff' : 'rgba(148,163,184,0.45)',
                      fontSize: '13px',
                      fontWeight: isActive ? 700 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {n}
                  </button>
                )
              })}

              {/* Siguiente */}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent',
                  color: safePage === totalPages ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.5)',
                  fontSize: '13px',
                  cursor: safePage === totalPages ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
