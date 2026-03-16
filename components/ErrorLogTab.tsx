'use client'

import { useState } from 'react'
import type { ErrorEntry } from '@/lib/types'

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string; label: string }> = {
  error:   { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', label: 'ERROR' },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)',  label: 'WARN' },
  info:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.25)',  label: 'INFO' },
}

interface Props {
  entries: ErrorEntry[]
  onResolve: (id: string, resolved: boolean) => Promise<void>
  onClearResolved: () => Promise<void>
}

export default function ErrorLogTab({ entries, onResolve, onClearResolved }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState<'all' | 'error' | 'warning' | 'info'>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const filtered = entries.filter(e => {
    if (!showResolved && e.resolved) return false
    if (filterLevel !== 'all' && e.level !== filterLevel) return false
    return true
  })

  const unresolvedCount = entries.filter(e => !e.resolved).length

  const handleResolve = async (id: string, resolved: boolean) => {
    setLoadingId(id)
    try {
      await onResolve(id, resolved)
    } finally {
      setLoadingId(null)
    }
  }

  const handleClear = async () => {
    if (!confirm('¿Eliminar todos los errores resueltos?')) return
    setClearing(true)
    try {
      await onClearResolved()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
            {unresolvedCount} error{unresolvedCount !== 1 ? 'es' : ''} sin resolver
          </span>
          {/* Filtros de nivel */}
          {(['all', 'error', 'warning', 'info'] as const).map(lvl => {
            const active = filterLevel === lvl
            const style = lvl !== 'all' ? LEVEL_STYLES[lvl] : null
            return (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                style={{
                  padding: '4px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                  border: active
                    ? `1px solid ${style?.border ?? 'rgba(0,212,255,0.35)'}`
                    : '1px solid rgba(255,255,255,0.07)',
                  background: active
                    ? (style?.bg ?? 'rgba(0,212,255,0.08)')
                    : 'rgba(255,255,255,0.02)',
                  color: active
                    ? (style?.color ?? '#00d4ff')
                    : 'rgba(148,163,184,0.4)',
                  transition: 'all 0.15s',
                }}
              >
                {lvl === 'all' ? 'Todos' : style?.label}
              </button>
            )
          })}
          {/* Toggle resueltos */}
          <button
            onClick={() => setShowResolved(v => !v)}
            style={{
              padding: '4px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer',
              border: showResolved ? '1px solid rgba(0,255,136,0.3)' : '1px solid rgba(255,255,255,0.07)',
              background: showResolved ? 'rgba(0,255,136,0.06)' : 'rgba(255,255,255,0.02)',
              color: showResolved ? '#00ff88' : 'rgba(148,163,184,0.4)',
              transition: 'all 0.15s',
            }}
          >
            {showResolved ? '✓ Mostrando resueltos' : 'Ver resueltos'}
          </button>
        </div>

        <button
          onClick={handleClear}
          disabled={entries.filter(e => e.resolved).length === 0 || clearing}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '10px',
            border: '1px solid rgba(255,70,70,0.3)',
            background: 'rgba(255,70,70,0.06)',
            color: 'rgba(255,100,100,0.8)',
            cursor: entries.filter(e => e.resolved).length === 0 || clearing ? 'not-allowed' : 'pointer',
            opacity: entries.filter(e => e.resolved).length === 0 ? 0.4 : 1,
            transition: 'all 0.2s',
          }}
        >
          {clearing ? 'Limpiando...' : '🗑 Limpiar resueltos'}
        </button>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '16px', padding: '64px 0',
          background: 'linear-gradient(135deg, #0d1117, #111827)',
          border: '1px solid rgba(0,212,255,0.08)',
        }}>
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>
            {entries.length === 0 ? 'Sin errores registrados 🎉' : 'No hay errores con los filtros actuales'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(entry => {
            const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info
            const isExpanded = expandedId === entry.id
            const isLoading = loadingId === entry.id

            return (
              <div
                key={entry.id}
                style={{
                  borderRadius: '12px',
                  border: entry.resolved
                    ? '1px solid rgba(255,255,255,0.04)'
                    : `1px solid ${style.border}`,
                  background: entry.resolved
                    ? 'rgba(255,255,255,0.02)'
                    : style.bg,
                  opacity: entry.resolved ? 0.55 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {/* Fila principal */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px' }}>
                  {/* Badge nivel */}
                  <span style={{
                    flexShrink: 0,
                    padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 800,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: style.color, border: `1px solid ${style.border}`,
                    background: 'rgba(0,0,0,0.3)', marginTop: '1px',
                  }}>
                    {style.label}
                  </span>

                  {/* Contenido */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'rgba(0,212,255,0.5)', fontFamily: 'monospace' }}>
                        {entry.source}
                      </span>
                      <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.3)' }}>
                        {fmtDate(entry.timestamp)}
                      </span>
                    </div>
                    <p style={{
                      fontSize: '13px', color: entry.resolved ? 'rgba(148,163,184,0.4)' : 'rgba(226,232,240,0.9)',
                      lineHeight: '1.5', margin: 0,
                    }}>
                      {entry.resolved && <span style={{ marginRight: '6px' }}>✓</span>}
                      {entry.message}
                    </p>

                    {/* Contexto expandible */}
                    {entry.context && Object.keys(entry.context).length > 0 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        style={{
                          marginTop: '6px', fontSize: '11px', color: 'rgba(0,212,255,0.5)',
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0',
                        }}
                      >
                        {isExpanded ? '▲ ocultar contexto' : '▼ ver contexto'}
                      </button>
                    )}

                    {isExpanded && entry.context && (
                      <pre style={{
                        marginTop: '8px', padding: '10px 12px', borderRadius: '8px',
                        background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)',
                        fontSize: '11px', color: 'rgba(148,163,184,0.7)',
                        overflowX: 'auto', lineHeight: '1.6', fontFamily: 'monospace',
                      }}>
                        {JSON.stringify(entry.context, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Botón resolver */}
                  <button
                    onClick={() => handleResolve(entry.id, !entry.resolved)}
                    disabled={isLoading}
                    style={{
                      flexShrink: 0,
                      padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                      cursor: isLoading ? 'wait' : 'pointer',
                      border: entry.resolved
                        ? '1px solid rgba(148,163,184,0.15)'
                        : '1px solid rgba(0,255,136,0.3)',
                      background: entry.resolved
                        ? 'rgba(255,255,255,0.03)'
                        : 'rgba(0,255,136,0.07)',
                      color: entry.resolved
                        ? 'rgba(148,163,184,0.4)'
                        : '#00ff88',
                      transition: 'all 0.15s',
                      opacity: isLoading ? 0.5 : 1,
                    }}
                  >
                    {isLoading ? '...' : entry.resolved ? 'Reabrir' : '✓ Resolver'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
