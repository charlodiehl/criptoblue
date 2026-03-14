'use client'

import { useState } from 'react'
import type { Payment, Order } from '@/lib/types'

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

type ManualStep = 'form' | 'confirm'

interface ManualState {
  step: ManualStep
  storeName: string
  orderNumber: string
  matchedOrder: Order | null
  loading: boolean
}

interface Props {
  payments: Payment[]
  orders?: Order[]
  matchedIds?: Set<string>
  externallyMarkedIds?: Set<string>
  title?: string
  emptyText?: string
  onMarkReceived?: (mpPaymentId: string) => Promise<void>
  onManualLog?: (mpPaymentId: string, storeName: string, orderNumber: string, matchedOrder: Order | null) => Promise<void>
  loading?: boolean
}

export default function PaymentsListTab({
  payments, orders = [], matchedIds, externallyMarkedIds, title = 'Pagos · últimas 24hs',
  emptyText = 'No hay pagos en las últimas 24 horas',
  onMarkReceived, onManualLog, loading,
}: Props) {
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<string | null>(null)
  const [manualState, setManualState] = useState<ManualState>({
    step: 'form', storeName: '', orderNumber: '', matchedOrder: null, loading: false,
  })

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
    try { await onMarkReceived(mpPaymentId) } finally { setMarking(null) }
  }

  const openManual = (mpPaymentId: string) => {
    setManualOpen(mpPaymentId)
    setManualState({ step: 'form', storeName: '', orderNumber: '', matchedOrder: null, loading: false })
  }

  const closeManual = () => setManualOpen(null)

  const handleManualConfirmForm = () => {
    const { orderNumber } = manualState
    // Búsqueda exacta por número de orden
    const found = orders.find(o => o.orderNumber === orderNumber) || null
    if (found) {
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: found }))
    } else {
      // Sin match → confirmar directo sin TN
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: null }))
    }
  }

  const handleManualSubmit = async (mpPaymentId: string, withTN: boolean) => {
    if (!onManualLog) return
    const { storeName, orderNumber, matchedOrder } = manualState
    setManualState(s => ({ ...s, loading: true }))
    try {
      await onManualLog(mpPaymentId, storeName, orderNumber, withTN ? matchedOrder : null)
      closeManual()
    } finally {
      setManualState(s => ({ ...s, loading: false }))
    }
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}>
        <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>{emptyText}</p>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: '12px', padding: '6px 10px', borderRadius: '7px',
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)',
    color: 'rgba(226,232,240,0.9)', outline: 'none',
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
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>Pág. {currentPage} / {totalPages}</span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
        {pageItems.map(p => {
          const isExternal = externallyMarkedIds?.has(p.mpPaymentId)
          const matched = matchedIds?.has(p.mpPaymentId)
          const isMarking = marking === p.mpPaymentId
          const isManualOpen = manualOpen === p.mpPaymentId
          const ms = manualState

          return (
            <div key={p.mpPaymentId} style={{
              background: isExternal ? 'linear-gradient(160deg,#1a1700 0%,#1f1c00 100%)' : matched ? 'linear-gradient(160deg,#0a1a10 0%,#0d1f14 100%)' : 'linear-gradient(160deg,#0d1117 0%,#0f1824 100%)',
              border: isExternal ? '1px solid rgba(255,220,0,0.25)' : matched ? '1px solid rgba(0,255,136,0.25)' : '1px solid rgba(0,212,255,0.1)',
              borderRadius: '14px', padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <p style={{ fontSize: '20px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em', margin: 0 }}>
                  {ARS.format(p.monto)}
                </p>
                {isExternal && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#ffd700', letterSpacing: '0.05em', textShadow: '0 0 8px rgba(255,215,0,0.4)' }}>
                    NO ES TIENDAS
                  </span>
                )}
                {!isExternal && matched && (
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
              {p.nombrePagador
                ? <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombrePagador}</p>
                : <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '3px' }}>Sin nombre</p>
              }
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>{fmtDate(p.fechaPago)}</p>
              {p.emailPagador && (
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
                  {p.emailPagador}
                </p>
              )}

              {/* Botones de acción — solo en pagos no marcados */}
              {!matched && (
                <div style={{ paddingTop: '8px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {onMarkReceived && (
                    <button onClick={() => handleMarkReceived(p.mpPaymentId)} disabled={!!loading || !!marking}
                      style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(255,220,0,0.25)', background: 'transparent', color: isMarking ? 'rgba(255,215,0,0.4)' : 'rgba(255,215,0,0.7)', cursor: (loading || marking) ? 'not-allowed' : 'pointer', opacity: (loading || (marking && !isMarking)) ? 0.4 : 1 }}>
                      {isMarking ? '...' : 'No es de tiendas'}
                    </button>
                  )}
                  {onManualLog && !isManualOpen && (
                    <button onClick={() => openManual(p.mpPaymentId)}
                      style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: 'rgba(148,163,184,0.55)', cursor: 'pointer' }}>
                      ✎ Marcar manualmente
                    </button>
                  )}
                </div>
              )}

              {/* Formulario inline — Marcar manualmente */}
              {!matched && isManualOpen && (
                <div style={{ marginTop: '10px', padding: '12px', borderRadius: '10px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  {ms.step === 'form' && (
                    <>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(148,163,184,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
                        Marcar manualmente
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        <input
                          style={inputStyle}
                          placeholder="Tienda (ej: Perla)"
                          value={ms.storeName}
                          onChange={e => setManualState(s => ({ ...s, storeName: e.target.value }))}
                        />
                        <input
                          style={inputStyle}
                          placeholder="Nro de orden (ej: 67521)"
                          value={ms.orderNumber}
                          onChange={e => setManualState(s => ({ ...s, orderNumber: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && ms.orderNumber) handleManualConfirmForm() }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                        <button
                          onClick={handleManualConfirmForm}
                          disabled={!ms.orderNumber && !ms.storeName}
                          style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.08)', color: 'rgba(0,212,255,0.8)', cursor: (!ms.orderNumber && !ms.storeName) ? 'not-allowed' : 'pointer', opacity: (!ms.orderNumber && !ms.storeName) ? 0.4 : 1 }}>
                          Continuar →
                        </button>
                        <button onClick={closeManual}
                          style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(148,163,184,0.4)', cursor: 'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </>
                  )}

                  {ms.step === 'confirm' && (
                    <>
                      {ms.matchedOrder ? (
                        <>
                          <p style={{ fontSize: '11px', fontWeight: 700, color: '#00ff88', marginBottom: '6px' }}>
                            ✓ Orden encontrada
                          </p>
                          <p style={{ fontSize: '12px', color: 'rgba(226,232,240,0.8)', marginBottom: '2px' }}>
                            #{ms.matchedOrder.orderNumber} — {ms.matchedOrder.customerName || 'Sin nombre'}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                            {ARS.format(ms.matchedOrder.total)} · {ms.matchedOrder.storeName}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                            ¿Marcar como pagada en TiendaNube y registrar el match?
                          </p>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button onClick={() => handleManualSubmit(p.mpPaymentId, true)} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: ms.loading ? 'not-allowed' : 'pointer', opacity: ms.loading ? 0.5 : 1 }}>
                              {ms.loading ? '...' : '✓ Sí, marcar en TN'}
                            </button>
                            <button onClick={() => handleManualSubmit(p.mpPaymentId, false)} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.15)', background: 'transparent', color: 'rgba(148,163,184,0.5)', cursor: ms.loading ? 'not-allowed' : 'pointer' }}>
                              Solo registrar
                            </button>
                            <button onClick={() => setManualState(s => ({ ...s, step: 'form' }))} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'rgba(148,163,184,0.3)', cursor: 'pointer' }}>
                              ← Volver
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize: '11px', color: 'rgba(255,180,0,0.7)', marginBottom: '6px' }}>
                            ⚠ No se encontró ninguna orden con ese número
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                            Se registrará el pago con los datos ingresados sin marcar nada en TiendaNube.
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', marginBottom: '10px' }}>
                            Tienda: <span style={{ color: 'rgba(226,232,240,0.7)' }}>{ms.storeName || '—'}</span>
                            {' · '}Orden: <span style={{ color: 'rgba(226,232,240,0.7)' }}>{ms.orderNumber || '—'}</span>
                          </p>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => handleManualSubmit(p.mpPaymentId, false)} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.06)', color: 'rgba(0,212,255,0.7)', cursor: ms.loading ? 'not-allowed' : 'pointer', opacity: ms.loading ? 0.5 : 1 }}>
                              {ms.loading ? '...' : 'Registrar de todas formas'}
                            </button>
                            <button onClick={() => setManualState(s => ({ ...s, step: 'form' }))}
                              style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'rgba(148,163,184,0.3)', cursor: 'pointer' }}>
                              ← Volver
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '24px' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
            style={{ padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', background: currentPage === 1 ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.15)', color: currentPage === 1 ? 'rgba(148,163,184,0.3)' : 'rgba(0,212,255,0.8)' }}>
            ← Anterior
          </button>
          <span style={{ fontSize: '12px', color: 'rgba(148,163,184,0.5)' }}>{currentPage} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
            style={{ padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', background: currentPage === totalPages ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.15)', color: currentPage === totalPages ? 'rgba(148,163,184,0.3)' : 'rgba(0,212,255,0.8)' }}>
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
