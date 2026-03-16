'use client'

import { useState, useMemo } from 'react'
import type { Order } from '@/lib/types'

function matchesSearch(query: string, fields: (string | number | undefined | null)[]): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim().replace(/[$.,']/g, '')
  return fields.some(f => {
    if (f == null) return false
    return String(f).toLowerCase().replace(/[$.,']/g, '').includes(q)
  })
}

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

interface ManualPayForm {
  medioPago: string
  monto: string
  nombrePagador: string
  loading: boolean
}

interface Props {
  orders: Order[]
  matchedIds?: Set<string>
  onMarkExternal?: (orderId: string, storeId: string) => Promise<void>
  onMarkManual?: (orderId: string, storeId: string, monto: number, medioPago: string, nombrePagador: string, order: Order) => Promise<void>
  loading?: boolean
}

export default function OrdersListTab({ orders, matchedIds, onMarkExternal, onMarkManual, loading }: Props) {
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<string | null>(null)
  const [manualForm, setManualForm] = useState<ManualPayForm>({ medioPago: '', monto: '', nombrePagador: '', loading: false })
  const [search, setSearch] = useState('')

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

  const openManual = (key: string, orderTotal: number) => {
    setManualOpen(key)
    setManualForm({ medioPago: '', monto: String(orderTotal), nombrePagador: '', loading: false })
  }

  const handleManualSubmit = async (o: Order) => {
    if (!onMarkManual || manualForm.loading) return
    const monto = parseFloat(manualForm.monto.replace(',', '.'))
    if (!manualForm.medioPago.trim() || isNaN(monto) || monto <= 0) return
    setManualForm(f => ({ ...f, loading: true }))
    try {
      await onMarkManual(o.orderId, o.storeId, monto, manualForm.medioPago.trim(), manualForm.nombrePagador.trim(), o)
      setManualOpen(null)
    } finally {
      setManualForm(f => ({ ...f, loading: false }))
    }
  }

  // orders ya vienen filtradas y ordenadas desde page.tsx
  const allSorted = useMemo(() =>
    [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders]
  )
  const sorted = useMemo(() => {
    if (!search.trim()) return allSorted
    return allSorted.filter(o => matchesSearch(search, [o.customerName, o.customerCuit, o.orderNumber, o.total, o.storeName]))
  }, [allSorted, search])
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
      {/* Buscador */}
      <div style={{ marginBottom: '12px', position: 'relative' }}>
        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: 'rgba(0,212,255,0.4)', pointerEvents: 'none' }}>⌕</span>
        <input
          type="text"
          placeholder="Buscar por nombre, CUIT, nro de orden o monto..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '9px 12px 9px 32px', borderRadius: '10px',
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)',
            color: 'rgba(226,232,240,0.9)', fontSize: '13px', outline: 'none',
          }}
        />
        {search && (
          <button onClick={() => { setSearch(''); setPage(1) }} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(148,163,184,0.4)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
        )}
      </div>
      {/* Header */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)' }}>
            Últimas 48hs
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>
            {sorted.length} orden{sorted.length !== 1 ? 'es' : ''}{search.trim() ? ` encontrada${sorted.length !== 1 ? 's' : ''}` : ''}
          </span>
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
              {/* Botones — solo en órdenes no marcadas */}
              {!matched && (
                <div style={{ paddingTop: '8px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {onMarkExternal && (
                    <button
                      onClick={() => handleMarkExternal(o.orderId, o.storeId)}
                      disabled={!!loading || !!marking}
                      style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.2)', background: 'transparent', color: isMarking ? 'rgba(0,255,136,0.4)' : 'rgba(0,255,136,0.55)', cursor: (loading || marking) ? 'not-allowed' : 'pointer', opacity: (loading || (marking && !isMarking)) ? 0.4 : 1 }}
                    >
                      {isMarking ? '...' : '✓ Orden marcada'}
                    </button>
                  )}
                  {onMarkManual && manualOpen !== key && (
                    <button
                      onClick={() => openManual(key, o.total)}
                      disabled={!!loading || !!marking}
                      style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: 'rgba(148,163,184,0.55)', cursor: 'pointer' }}
                    >
                      ✎ Marcar manualmente
                    </button>
                  )}
                </div>
              )}

              {/* Formulario inline de marcado manual */}
              {!matched && manualOpen === key && (
                <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', border: '1px solid rgba(148,163,184,0.12)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Medio de pago *</label>
                      <input
                        type="text"
                        placeholder="Ej: MercadoPago, Transferencia, Efectivo"
                        value={manualForm.medioPago}
                        onChange={e => setManualForm(f => ({ ...f, medioPago: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Monto recibido *</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={manualForm.monto}
                        onChange={e => setManualForm(f => ({ ...f, monto: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Nombre pagador</label>
                      <input
                        type="text"
                        placeholder="Opcional"
                        value={manualForm.nombrePagador}
                        onChange={e => setManualForm(f => ({ ...f, nombrePagador: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                      <button
                        onClick={() => handleManualSubmit(o)}
                        disabled={manualForm.loading || !manualForm.medioPago.trim() || !manualForm.monto}
                        style={{ flex: 1, fontSize: '12px', fontWeight: 700, padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: 'pointer', opacity: (manualForm.loading || !manualForm.medioPago.trim() || !manualForm.monto) ? 0.4 : 1 }}
                      >
                        {manualForm.loading ? '...' : 'Confirmar'}
                      </button>
                      <button
                        onClick={() => setManualOpen(null)}
                        style={{ fontSize: '12px', padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.15)', background: 'transparent', color: 'rgba(148,163,184,0.5)', cursor: 'pointer' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
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
