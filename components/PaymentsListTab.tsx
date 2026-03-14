'use client'

import { useState } from 'react'
import type { Payment } from '@/lib/types'

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
  payments: Payment[]
  matchedIds?: Set<string>
  title?: string
  emptyText?: string
  onMarkReceived?: (mpPaymentId: string) => Promise<void>
  loading?: boolean
}

export default function PaymentsListTab({ payments, matchedIds, title = 'Pagos · últimas 24hs', emptyText = 'No hay pagos en las últimas 24 horas', onMarkReceived, loading }: Props) {
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)

  const sorted = [...payments].sort((a, b) => {
    const ta = a.fechaPago ? new Date(a.fechaPago).getTime() : 0
    const tb = b.fechaPago ? new Date(b.fechaPago).getTime() : 0
    return tb - ta
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleMarkReceived = async (mpPaymentId: string) => {
    if (!onMarkReceived || marking) return
    setMarking(mpPaymentId)
    try {
      await onMarkReceived(mpPaymentId)
    } finally {
      setMarking(null)
    }
  }

  if (sorted.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
      >
        <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>{emptyText}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)' }}>
            {title}
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>{sorted.length} pago{sorted.length !== 1 ? 's' : ''}</span>
        </div>
        {totalPages > 1 && (
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>
            Pág. {currentPage} / {totalPages}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
        {pageItems.map(p => {
          const matched = matchedIds?.has(p.mpPaymentId)
          const isMarking = marking === p.mpPaymentId
          return (
            <div
              key={p.mpPaymentId}
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
                  {ARS.format(p.monto)}
                </p>
                {matched && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#00ff88', letterSpacing: '0.05em', textShadow: '0 0 8px rgba(0,255,136,0.4)' }}>
                    ✓ RECIBIDO
                  </span>
                )}
              </div>
              {p.cuitPagador && (
                <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.65)', fontWeight: 600, marginBottom: '3px' }}>
                  CUIT/DNI: {p.cuitPagador}
                </p>
              )}
              {p.nombrePagador ? (
                <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nombrePagador}
                </p>
              ) : (
                <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '3px' }}>Sin nombre</p>
              )}
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>
                {fmtDate(p.fechaPago)}
              </p>
              {p.emailPagador && (
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
                  {p.emailPagador}
                </p>
              )}
              {/* Botón "Pago recibido" — solo en pagos no marcados */}
              {!matched && onMarkReceived && (
                <div style={{ paddingTop: '8px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <button
                    onClick={() => handleMarkReceived(p.mpPaymentId)}
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
                    {isMarking ? '...' : '✓ Pago recibido'}
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
