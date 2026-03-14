'use client'

import { useState } from 'react'
import type { Order } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

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

const PAGE_SIZE = 100

interface Props {
  orders: Order[]
  matchedIds?: Set<string>
  onMarkExternal?: (orderId: string, storeId: string) => Promise<void>
  loading?: boolean
}

export default function OrdersListTab({ orders, matchedIds, onMarkExternal, loading }: Props) {
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)

  const handleMarkExternal = async (orderId: string, storeId: string) => {
    if (!onMarkExternal || marking) return
    const key = `${storeId}-${orderId}`
    setMarking(key)
    try {
      await onMarkExternal(orderId, storeId)
    } finally {
      setMarking(null)
    }
  }

  // orders ya vienen filtradas y ordenadas desde page.tsx
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  if (sorted.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
      >
        <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>No hay órdenes en las últimas 48hs</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)' }}>
            Últimas 48hs
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>{sorted.length} orden{sorted.length !== 1 ? 'es' : ''}</span>
        </div>
        {totalPages > 1 && (
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>
            Pág. {currentPage} / {totalPages}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
        {pageItems.map(o => {
          const key = `${o.storeId}-${o.orderId}`
          const matched = matchedIds?.has(key)
          const isMarking = marking === key
          return (
            <div
              key={key}
              style={{
                background: matched
                  ? 'linear-gradient(160deg, #0a1a10 0%, #0d1f14 100%)'
                  : 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)',
                border: matched
                  ? '1px solid rgba(0,255,136,0.25)'
                  : '1px solid rgba(0,212,255,0.1)',
                borderRadius: '14px',
                padding: '16px 18px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <p style={{ fontSize: '20px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em', margin: 0 }}>
                  {ARS.format(o.total)}
                </p>
                {matched && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#00ff88', letterSpacing: '0.05em', textShadow: '0 0 8px rgba(0,255,136,0.4)' }}>
                    ✓ MARCADO
                  </span>
                )}
              </div>
              {o.customerCuit && (
                <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.65)', fontWeight: 600, marginBottom: '3px' }}>
                  CUIT/DNI: {o.customerCuit}
                </p>
              )}
              {o.customerName ? (
                <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.customerName}
                </p>
              ) : (
                <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '3px' }}>Sin nombre</p>
              )}
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>
                {fmtDate(o.createdAt)}
              </p>
              {o.customerEmail && (
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '3px' }}>
                  {o.customerEmail}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#00d4ff', letterSpacing: '0.05em' }}>
                  #{o.orderNumber}
                </span>
                {o.storeName && (
                  <span style={{ fontSize: '10px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {o.storeName}
                  </span>
                )}
              </div>
              {/* Botón "Orden marcada" — solo en órdenes no marcadas */}
              {!matched && onMarkExternal && (
                <div style={{ paddingTop: '8px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <button
                    onClick={() => handleMarkExternal(o.orderId, o.storeId)}
                    disabled={!!loading || !!marking}
                    style={{
                      fontSize: '11px',
                      padding: '5px 10px',
                      borderRadius: '7px',
                      border: '1px solid rgba(0,255,136,0.2)',
                      background: 'transparent',
                      color: isMarking ? 'rgba(0,255,136,0.4)' : 'rgba(0,255,136,0.55)',
                      cursor: (loading || marking) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      opacity: (loading || (marking && !isMarking)) ? 0.4 : 1,
                    }}
                    onMouseEnter={e => { if (!loading && !marking) { (e.currentTarget as HTMLElement).style.color = '#00ff88'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,136,0.4)' } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(0,255,136,0.55)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,136,0.2)' }}
                  >
                    {isMarking ? '...' : '✓ Orden marcada'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '24px' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{
              padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              background: currentPage === 1 ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.1)',
              border: '1px solid rgba(0,212,255,0.15)', color: currentPage === 1 ? 'rgba(148,163,184,0.3)' : 'rgba(0,212,255,0.8)',
            }}
          >← Anterior</button>
          <span style={{ fontSize: '12px', color: 'rgba(148,163,184,0.5)' }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              background: currentPage === totalPages ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.1)',
              border: '1px solid rgba(0,212,255,0.15)', color: currentPage === totalPages ? 'rgba(148,163,184,0.3)' : 'rgba(0,212,255,0.8)',
            }}
          >Siguiente →</button>
        </div>
      )}
    </div>
  )
}
