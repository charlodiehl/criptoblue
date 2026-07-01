'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { LogEntry } from '@/lib/types'
import { fmtDate, billeteraLabel } from '@/lib/utils'

function fmtMontoDisplay(n: number) {
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function fmtMontoTSV(n: number) {
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function fmtCuit(s: string) {
  return (s || '').replace(/\D/g, '')
}

function billetera(entry: LogEntry): string {
  return billeteraLabel(entry.payment?.source)
}

function nombrePagador(entry: LogEntry): string {
  return entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || ''
}

type SortKey = 'fecha' | 'monto' | 'cuit' | 'nombre' | 'tienda' | 'orden' | 'billetera'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 100

// Cache local para mark_copied — persiste aunque falle la conexión
const PENDING_KEY = 'criptoblue:pending_copied'
function localPendingGet(): string[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') } catch { return [] }
}
function localPendingAdd(timestamps: string[]) {
  const s = new Set(localPendingGet())
  for (const ts of timestamps) s.add(ts)
  localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(s)))
}
function localPendingRemove(timestamps: string[]) {
  const remove = new Set(timestamps)
  const updated = localPendingGet().filter(ts => !remove.has(ts))
  if (updated.length === 0) localStorage.removeItem(PENDING_KEY)
  else localStorage.setItem(PENDING_KEY, JSON.stringify(updated))
}

interface Props {
  // Señal del padre: se incrementa cuando el log cambia (realtime / edición / cron)
  // para que el Registro re-consulte su página actual.
  refreshKey?: number
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

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  fecha: 'desc', monto: 'desc', cuit: 'desc',
  nombre: 'asc', tienda: 'asc', orden: 'desc', billetera: 'asc',
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

const filterInputStyle: React.CSSProperties = {
  background: 'rgba(0,212,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: 'rgba(226,232,240,0.85)',
  fontSize: '13px',
  padding: '7px 10px',
  outline: 'none',
}

export default function RegistroTab({ refreshKey = 0, onEntryEdited }: Props) {
  const [copied, setCopied] = useState(false)
  const [markingCopied, setMarkingCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [pendingCopied, setPendingCopied] = useState<Set<string>>(new Set())
  const onEntryEditedRef = useRef(onEntryEdited)
  useEffect(() => { onEntryEditedRef.current = onEntryEdited }, [onEntryEdited])

  // Filtros
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Debounce de la búsqueda (evita una consulta por tecla)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(id)
  }, [search])

  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  // Datos de la página actual (server-side)
  const [rows, setRows] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [newCount, setNewCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Construye los params de filtro compartidos (página y copia).
  // Sin filtro por mes: la lista abarca toda la historia, paginada.
  const buildFilterParams = (): URLSearchParams => {
    const p = new URLSearchParams()
    if (debouncedSearch.trim()) p.set('q', debouncedSearch.trim())
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    return p
  }

  // Fetch de la página actual
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = buildFilterParams()
    params.set('paged', '1')
    params.set('page', String(page))
    params.set('sort', sortKey)
    params.set('dir', sortDir)
    fetch(`/api/log?${params.toString()}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return
        setRows(data.entries ?? [])
        setTotal(data.total ?? 0)
        setNewCount(data.newCount ?? 0)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, dateFrom, dateTo, sortKey, sortDir, reloadKey, refreshKey])

  // Reset de página al cambiar filtros/orden
  useEffect(() => { setPage(1) }, [debouncedSearch, dateFrom, dateTo, sortKey, sortDir])

  const reload = () => setReloadKey(k => k + 1)

  // Flush pendientes al server
  async function flushPending(timestamps: string[]) {
    if (timestamps.length === 0) return
    try {
      const res = await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_copied', timestamps }),
      })
      if (!res.ok) return
      localPendingRemove(timestamps)
      setPendingCopied(prev => {
        const next = new Set(prev)
        for (const ts of timestamps) next.delete(ts)
        return next
      })
      onEntryEditedRef.current?.()
      reload()
    } catch { /* reintentará en el próximo foco */ }
  }

  useEffect(() => {
    const pending = localPendingGet()
    if (pending.length > 0) {
      setPendingCopied(new Set(pending))
      flushPending(pending)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onFocus = () => {
      const pending = localPendingGet()
      if (pending.length > 0) flushPending(pending)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Inline edit state
  const [editingTs, setEditingTs] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCuit, setEditCuit] = useState('')
  const [editOrderNumber, setEditOrderNumber] = useState('')
  const [editStoreName, setEditStoreName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  // Copiar: trae TODOS los pendientes (sin copiar) que cumplen los filtros actuales
  const handleCopy = async () => {
    setMarkingCopied(true)
    setCopyError(null)
    let toCopy: LogEntry[] = []
    try {
      const params = buildFilterParams()
      params.set('mode', 'copy')
      const res = await fetch(`/api/log?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        toCopy = (data.entries ?? []).filter((e: LogEntry) => !pendingCopied.has(e.timestamp))
      }
    } catch {
      setCopyError('No se pudieron obtener los pendientes — revisá la conexión.')
      setMarkingCopied(false)
      return
    }

    if (toCopy.length === 0) { setMarkingCopied(false); return }

    // Orden estable para el pegado: por fecha ascendente
    toCopy.sort((a, b) =>
      new Date(a.payment?.fechaPago || a.timestamp).getTime() -
      new Date(b.payment?.fechaPago || b.timestamp).getTime())

    const tsvRows = toCopy.map(e => [
      fmtDate(e.payment?.fechaPago || e.timestamp),
      fmtMontoTSV(e.payment?.monto ?? e.amount ?? 0),
      fmtCuit(e.payment?.cuitPagador || ''),
      nombrePagador(e),
      e.storeName || e.order?.storeName || '',
      (e.orderNumber || e.order?.orderNumber || '').replace(/^#/, ''),
      billetera(e),
    ])

    const tsv = tsvRows.map(r => r.join('\t')).join('\n')
    await navigator.clipboard.writeText(tsv)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)

    // Marcar localmente las copiadas (optimista)
    const timestamps = toCopy.map(e => e.timestamp)
    localPendingAdd(timestamps)
    setPendingCopied(prev => {
      const next = new Set(prev)
      for (const ts of timestamps) next.add(ts)
      return next
    })
    setNewCount(0)

    // Sincronizar al servidor
    try {
      const res = await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_copied', timestamps }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      localPendingRemove(timestamps)
      setPendingCopied(prev => {
        const next = new Set(prev)
        for (const ts of timestamps) next.delete(ts)
        return next
      })
      onEntryEdited?.()
      reload()
    } catch {
      setCopyError('Conexión inestable — los registros se marcaron localmente y se sincronizarán al recuperar la conexión.')
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
      reload()
    } catch {
      setEditError('Error de red')
    } finally {
      setEditSaving(false)
    }
  }

  const hasFilters = !!(dateFrom || dateTo || search.trim())

  // Ventana deslizante de paginación
  const WINDOW_SIZE = 10
  const paginationItems = useMemo((): (number | '...')[] => {
    if (totalPages <= WINDOW_SIZE) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    let wStart = Math.max(1, safePage - Math.floor(WINDOW_SIZE / 2))
    let wEnd = wStart + WINDOW_SIZE - 1
    if (wEnd > totalPages) {
      wEnd = totalPages
      wStart = Math.max(1, wEnd - WINDOW_SIZE + 1)
    }
    const items: (number | '...')[] = []
    if (wStart > 1) {
      items.push(1)
      if (wStart > 2) items.push('...')
    }
    for (let i = wStart; i <= wEnd; i++) items.push(i)
    if (wEnd < totalPages) {
      if (wEnd < totalPages - 1) items.push('...')
      items.push(totalPages)
    }
    return items
  }, [totalPages, safePage])

  return (
    <div>
      {/* Error de marcado copiado */}
      {copyError && (
        <div style={{
          marginBottom: '12px', padding: '10px 14px', borderRadius: '8px',
          background: 'rgba(255,70,70,0.08)', border: '1px solid rgba(255,70,70,0.3)',
          color: 'rgba(255,120,120,0.95)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <span>⚠ {copyError}</span>
          <button onClick={() => setCopyError(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,120,120,0.7)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px' }}>✕</button>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
        {/* Búsqueda */}
        <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
          <input
            type="text"
            placeholder="Buscar en toda la historia: nombre, orden, tienda, CUIT, monto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...filterInputStyle, width: '100%' }}
          />
        </div>

        {/* Fecha desde */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Desde</span>
          <div
            onClick={e => { (e.currentTarget.querySelector('input') as HTMLInputElement)?.showPicker?.() }}
            style={{ ...filterInputStyle, width: '130px', position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
          >
            <span style={{ fontSize: '13px', color: dateFrom ? 'rgba(226,232,240,0.85)' : 'rgba(148,163,184,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {dateFrom ? dateFrom.split('-').reverse().join('/') : 'dd/mm/aaaa'}
            </span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Fecha hasta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Hasta</span>
          <div
            onClick={e => { (e.currentTarget.querySelector('input') as HTMLInputElement)?.showPicker?.() }}
            style={{ ...filterInputStyle, width: '130px', position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
          >
            <span style={{ fontSize: '13px', color: dateTo ? 'rgba(226,232,240,0.85)' : 'rgba(148,163,184,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {dateTo ? dateTo.split('-').reverse().join('/') : 'dd/mm/aaaa'}
            </span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Limpiar filtros */}
        {hasFilters && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setSearch('') }}
            style={{
              fontSize: '12px', padding: '7px 12px', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
              color: 'rgba(148,163,184,0.6)', cursor: 'pointer',
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Header con conteo y botón copiar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
          {total} emparejamiento{total !== 1 ? 's' : ''}
          {loading && <span style={{ marginLeft: '8px', color: 'rgba(148,163,184,0.5)' }}>Cargando…</span>}
          {newCount > 0 && (
            <span style={{ marginLeft: '8px', color: 'rgba(226,232,240,0.75)', fontWeight: 600 }}>
              · {newCount} nuevo{newCount !== 1 ? 's' : ''} sin copiar
            </span>
          )}
        </span>
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
          {copied ? '✓ Copiado' : `⧉ Copiar ${newCount > 0 ? newCount + ' ' : ''}nuevos`}
        </button>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '16px', padding: '64px 0',
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.08)',
          }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>
            {loading ? 'Cargando…' : hasFilters ? 'No hay resultados para los filtros aplicados' : 'No hay emparejamientos registrados'}
          </p>
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
                        textAlign: 'left', padding: '10px 14px', fontSize: '10px', fontWeight: 700,
                        letterSpacing: '0.15em', textTransform: 'uppercase',
                        color: active ? 'rgba(0,212,255,0.9)' : 'rgba(0,212,255,0.5)',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                      }}
                    >
                      {col.label}{arrow}
                    </th>
                  )
                })}
                <th style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', width: '42px' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const isEditing = editingTs === e.timestamp
                const isNew = !e.copiedAt && !pendingCopied.has(e.timestamp)
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
                    <td style={{ padding: '12px 14px', color: isNew ? 'rgba(148,163,184,0.9)' : 'rgba(148,163,184,0.6)', fontWeight: isNew ? 700 : 400, whiteSpace: 'nowrap' }}>{fecha}</td>
                    <td style={{ padding: '12px 14px', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>{monto}</td>
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(0,212,255,0.95)' : 'rgba(0,212,255,0.7)', fontWeight: isNew ? 700 : 400, fontFamily: 'monospace' }}>
                      {isEditing ? (
                        <input value={editCuit} onChange={ev => setEditCuit(ev.target.value.replace(/\D/g, ''))} placeholder="CUIT sin guiones" maxLength={11}
                          style={{ ...inputStyle, fontFamily: 'monospace', color: 'rgba(0,212,255,0.9)' }}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(e.timestamp); if (ev.key === 'Escape') cancelEdit() }}
                        />
                      ) : (cuit || '—')}
                    </td>
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(226,232,240,0.95)' : 'rgba(226,232,240,0.85)', fontWeight: isNew ? 700 : 400, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input value={editName} onChange={ev => setEditName(ev.target.value)} placeholder="Nombre y apellido" autoFocus
                          style={inputStyle}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(e.timestamp); if (ev.key === 'Escape') cancelEdit() }}
                        />
                      ) : (nombre || '—')}
                    </td>
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: isNew ? 'rgba(148,163,184,0.8)' : 'rgba(148,163,184,0.5)', fontWeight: isNew ? 700 : 400, whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input value={editStoreName} onChange={ev => setEditStoreName(ev.target.value)} placeholder="Nombre de la tienda"
                          style={{ ...inputStyle, color: 'rgba(148,163,184,0.8)' }}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(e.timestamp); if (ev.key === 'Escape') cancelEdit() }}
                        />
                      ) : tienda}
                    </td>
                    <td style={{ padding: isEditing ? '6px 14px' : '12px 14px', color: '#00d4ff', fontWeight: 700, whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input value={editOrderNumber} onChange={ev => setEditOrderNumber(ev.target.value)} placeholder="Número de orden"
                          style={{ ...inputStyle, color: '#00d4ff', fontWeight: 600 }}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(e.timestamp); if (ev.key === 'Escape') cancelEdit() }}
                        />
                      ) : orden}
                    </td>
                    <td style={{ padding: '12px 14px', color: isNew ? 'rgba(148,163,184,0.7)' : 'rgba(148,163,184,0.4)', fontWeight: isNew ? 700 : 400, whiteSpace: 'nowrap' }}>{bill}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button onClick={() => saveEdit(e.timestamp)} disabled={editSaving} title="Guardar"
                            style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid rgba(0,255,136,0.4)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', fontSize: '13px', cursor: editSaving ? 'not-allowed' : 'pointer', opacity: editSaving ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            ✓
                          </button>
                          <button onClick={cancelEdit} disabled={editSaving} title="Cancelar"
                            style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid rgba(255,70,70,0.3)', background: 'rgba(255,70,70,0.06)', color: 'rgba(255,100,100,0.8)', fontSize: '13px', cursor: editSaving ? 'not-allowed' : 'pointer', opacity: editSaving ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(e)} title="Editar nombre y CUIT"
                          style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.07)', background: 'transparent', color: 'rgba(148,163,184,0.35)', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                          onMouseEnter={ev => { ev.currentTarget.style.color = 'rgba(0,212,255,0.7)'; ev.currentTarget.style.borderColor = 'rgba(0,212,255,0.3)'; ev.currentTarget.style.background = 'rgba(0,212,255,0.06)' }}
                          onMouseLeave={ev => { ev.currentTarget.style.color = 'rgba(148,163,184,0.35)'; ev.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; ev.currentTarget.style.background = 'transparent' }}
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

          {editError && (
            <div style={{ padding: '8px 14px', color: 'rgba(255,100,100,0.8)', fontSize: '12px' }}>
              ⚠ {editError}
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', padding: '20px 0 4px' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: safePage === 1 ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.5)', fontSize: '13px', cursor: safePage === 1 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                ‹
              </button>
              {paginationItems.map((item, idx) =>
                item === '...' ? (
                  <span key={`ellipsis-${idx}`} style={{ padding: '6px 2px', color: 'rgba(148,163,184,0.3)', fontSize: '13px', userSelect: 'none' }}>
                    …
                  </span>
                ) : (
                  <button key={item} onClick={() => setPage(item)}
                    style={{ minWidth: '34px', padding: '6px 4px', borderRadius: '8px', border: item === safePage ? '1px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.06)', background: item === safePage ? 'rgba(0,212,255,0.1)' : 'transparent', color: item === safePage ? '#00d4ff' : 'rgba(148,163,184,0.45)', fontSize: '13px', fontWeight: item === safePage ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s' }}>
                    {item}
                  </button>
                )
              )}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: safePage === totalPages ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.5)', fontSize: '13px', cursor: safePage === totalPages ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
