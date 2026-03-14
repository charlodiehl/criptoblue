'use client'

import { useState, useMemo } from 'react'
import type { LogEntry } from '@/lib/types'

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}

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

function billetera(_entry: LogEntry): string {
  return 'MercadoPago'
}

function nombrePagador(entry: LogEntry): string {
  return entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || ''
}

type SortKey = 'fecha' | 'monto' | 'cuit' | 'nombre' | 'tienda' | 'orden' | 'billetera'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

interface Props {
  entries: LogEntry[]
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

export default function RegistroTab({ entries }: Props) {
  const [copied, setCopied] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  const paid = useMemo(() => {
    const filtered = entries.filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
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

  const handleCopy = () => {
    const rows = paid.map(e => [
      fmtDate(e.payment?.fechaPago || e.timestamp),
      fmtMontoTSV(e.payment?.monto ?? e.amount ?? 0),
      fmtCuit(e.payment?.cuitPagador || ''),
      nombrePagador(e),
      e.storeName || e.order?.storeName || '',
      e.orderNumber || e.order?.orderNumber || '',
      billetera(e),
    ])

    const tsv = [HEADERS, ...rows].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
          {paid.length} emparejamiento{paid.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleCopy}
          disabled={paid.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            fontSize: '13px',
            fontWeight: 600,
            padding: '9px 18px',
            borderRadius: '10px',
            border: copied ? '1px solid rgba(0,255,136,0.4)' : '1px solid rgba(0,212,255,0.25)',
            background: copied ? 'rgba(0,255,136,0.08)' : 'rgba(0,212,255,0.06)',
            color: copied ? '#00ff88' : '#00d4ff',
            cursor: paid.length === 0 ? 'not-allowed' : 'pointer',
            opacity: paid.length === 0 ? 0.4 : 1,
            transition: 'all 0.2s',
          }}
        >
          {copied ? '✓ Copiado' : '⧉ Copiar para Google Sheets'}
        </button>
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
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e, i) => {
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
                      background: i % 2 === 0 ? 'transparent' : 'rgba(0,212,255,0.015)',
                    }}
                  >
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.6)', whiteSpace: 'nowrap' }}>{fecha}</td>
                    <td style={{ padding: '12px 14px', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>{monto}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(0,212,255,0.7)', fontFamily: 'monospace' }}>{cuit || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(226,232,240,0.85)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.5)', whiteSpace: 'nowrap' }}>{tienda}</td>
                    <td style={{ padding: '12px 14px', color: '#00d4ff', fontWeight: 600, whiteSpace: 'nowrap' }}>{orden}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.4)', whiteSpace: 'nowrap' }}>{bill}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

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
