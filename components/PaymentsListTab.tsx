'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import type { Payment, Order, Store } from '@/lib/types'
import { ARS, fmtDate, matchesSearch, billeteraLabel } from '@/lib/utils'
import { MONTO_DIFF_WARNING_THRESHOLD } from '@/lib/config'
import BuscarPagoModal from './BuscarPagoModal'
import CargarPagosModal from './CargarPagosModal'

const PAGE_SIZE = 100

type ManualStep = 'form' | 'confirm'

interface ManualState {
  step: ManualStep
  selectedStoreId: string | null   // null = nada seleccionado, 'otro' = texto libre
  storeNameCustom: string           // texto libre cuando selectedStoreId === 'otro'
  dropdownOpen: boolean
  orderNumber: string
  matchedOrder: Order | null
  isOtroMode: boolean               // true cuando se avanzó en modo texto libre
  loading: boolean
  confirmedDiff: boolean            // tildado por el operador para aceptar diferencia de monto
  searchError: string | null        // error al consultar la tienda directo (buscar-orden)
}

interface Props {
  payments: Payment[]
  orders?: Order[]
  stores?: Store[]
  matchedIds?: Set<string>
  externallyMarkedIds?: Set<string>
  title?: string
  emptyText?: string
  onMarkReceived?: (mpPaymentId: string) => Promise<void>
  onManualLog?: (mpPaymentId: string, storeName: string, orderNumber: string, matchedOrder: Order | null) => Promise<void>
  showBuscarPagos?: boolean
  onEmparejado?: (msg: string) => void
  loading?: boolean
}

export default function PaymentsListTab({
  payments, orders = [], stores = [], matchedIds, externallyMarkedIds,
  title = 'Pagos · últimas 24hs',
  emptyText = 'No hay pagos en las últimas 24 horas',
  onMarkReceived, onManualLog, showBuscarPagos, onEmparejado, loading,
}: Props) {
  const [buscarPagoOpen, setBuscarPagoOpen] = useState(false)
  const [cargarPagosOpen, setCargarPagosOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<string | null>(null)
  const [manualState, setManualState] = useState<ManualState>({
    step: 'form', selectedStoreId: null, storeNameCustom: '', dropdownOpen: false,
    orderNumber: '', matchedOrder: null, isOtroMode: false, loading: false, confirmedDiff: false,
    searchError: null,
  })
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    if (!manualState.dropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setManualState(s => ({ ...s, dropdownOpen: false }))
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [manualState.dropdownOpen])

  const allSorted = useMemo(() => [...payments].sort((a, b) => {
    const ta = a.fechaPago ? new Date(a.fechaPago).getTime() : 0
    const tb = b.fechaPago ? new Date(b.fechaPago).getTime() : 0
    return tb - ta
  }), [payments])

  const sorted = useMemo(() => {
    if (!search.trim()) return allSorted
    return allSorted.filter(p => matchesSearch(search, [p.nombrePagador, p.cuitPagador, p.monto, p.emailPagador]))
  }, [allSorted, search])

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
    setManualState({
      step: 'form', selectedStoreId: null, storeNameCustom: '', dropdownOpen: false,
      orderNumber: '', matchedOrder: null, isOtroMode: false, loading: false, confirmedDiff: false,
      searchError: null,
    })
  }

  const closeManual = () => setManualOpen(null)

  // Diferencia entre monto del pago y total de la orden. Devuelve info si supera el umbral.
  // Sirve para mostrar warning y bloquear confirmación hasta tildar checkbox explícito.
  const calcularDiff = (paymentMonto: number, orderTotal: number | undefined) => {
    if (!orderTotal || orderTotal <= 0) return null
    const diff = paymentMonto - orderTotal
    const abs = Math.abs(diff)
    if (abs <= MONTO_DIFF_WARNING_THRESHOLD) return null
    return { diff, abs, paymentMonto, orderTotal, paymentMenor: diff < 0 }
  }

  // Deriva el nombre de tienda según el modo seleccionado
  const resolverStoreName = (ms: ManualState): string => {
    if (ms.selectedStoreId === 'otro') return ms.storeNameCustom
    return stores.find(s => s.storeId === ms.selectedStoreId)?.storeName ?? ''
  }

  const handleManualConfirmForm = async () => {
    const { orderNumber, selectedStoreId } = manualState

    // Modo "Otro": sin validación, ir directo a confirmación
    if (selectedStoreId === 'otro') {
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: null, isOtroMode: true, searchError: null }))
      return
    }

    // Tienda seleccionada: primero buscar en el cache local (rápido, sin API)
    const cached = selectedStoreId
      ? orders.find(o => o.orderNumber === orderNumber && o.storeId === selectedStoreId) ?? null
      : orders.find(o => o.orderNumber === orderNumber) ?? null

    if (cached || !selectedStoreId) {
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: cached, isOtroMode: false, searchError: null }))
      return
    }

    // No está en el cache (rolling 48hs): buscar directo en la tienda,
    // sin restricción de antigüedad — encuentra órdenes de cualquier fecha.
    setManualState(s => ({ ...s, loading: true, searchError: null }))
    try {
      const res = await fetch('/api/buscar-orden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, storeId: selectedStoreId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        setManualState(s => ({ ...s, step: 'confirm', matchedOrder: null, isOtroMode: false, loading: false, searchError: String(data.error || `Error ${res.status}`) }))
        return
      }
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: data.order ?? null, isOtroMode: false, loading: false }))
    } catch (err) {
      setManualState(s => ({ ...s, step: 'confirm', matchedOrder: null, isOtroMode: false, loading: false, searchError: String(err) }))
    }
  }

  const handleManualSubmit = async (mpPaymentId: string, withTN: boolean) => {
    if (!onManualLog) return
    const { orderNumber, matchedOrder } = manualState
    const storeName = resolverStoreName(manualState)
    setManualState(s => ({ ...s, loading: true }))
    try {
      await onManualLog(mpPaymentId, storeName, orderNumber, withTN ? matchedOrder : null)
      closeManual()
    } finally {
      setManualState(s => ({ ...s, loading: false }))
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: '12px', padding: '6px 10px', borderRadius: '7px',
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)',
    color: 'rgba(226,232,240,0.9)', outline: 'none',
  }

  // Etiqueta del botón del dropdown
  const labelTiendaSeleccionada = (ms: ManualState): string => {
    if (ms.selectedStoreId === null) return ''
    if (ms.selectedStoreId === 'otro') return ms.storeNameCustom || 'Otro / texto libre'
    return stores.find(s => s.storeId === ms.selectedStoreId)?.storeName ?? ''
  }

  // El formulario requiere tienda seleccionada y número de orden
  const puedeConfirmar = (ms: ManualState): boolean => {
    if (!ms.orderNumber.trim()) return false
    if (ms.selectedStoreId === null) return false
    if (ms.selectedStoreId === 'otro' && !ms.storeNameCustom.trim()) return false
    return true
  }

  return (
    <div>
      {/* Botones Buscar Pagos / Cargar pagos (solo pestaña Pagos) */}
      {showBuscarPagos && (
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {stores.length > 0 && (
            <button
              onClick={() => setBuscarPagoOpen(true)}
              style={{
                fontSize: '12px', fontWeight: 600, padding: '7px 14px', borderRadius: '8px',
                border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.07)',
                color: 'rgba(0,212,255,0.85)', cursor: 'pointer', letterSpacing: '0.02em',
              }}
            >
              🔎 Buscar Pagos
            </button>
          )}
          <button
            onClick={() => setCargarPagosOpen(true)}
            style={{
              fontSize: '12px', fontWeight: 600, padding: '7px 14px', borderRadius: '8px',
              border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.06)',
              color: 'rgba(0,255,136,0.85)', cursor: 'pointer', letterSpacing: '0.02em',
            }}
          >
            📥 Cargar pagos
          </button>
        </div>
      )}
      {buscarPagoOpen && (
        <BuscarPagoModal
          stores={stores}
          onClose={() => setBuscarPagoOpen(false)}
          onEmparejado={msg => onEmparejado?.(msg)}
        />
      )}
      {cargarPagosOpen && (
        <CargarPagosModal
          onClose={() => setCargarPagosOpen(false)}
          onCargado={msg => onEmparejado?.(msg)}
        />
      )}

      {/* Buscador */}
      <div style={{ marginBottom: '12px', position: 'relative' }}>
        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: 'rgba(0,212,255,0.4)', pointerEvents: 'none' }}>⌕</span>
        <input
          type="text"
          placeholder="Buscar por nombre, CUIT o monto..."
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
            {title}
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>
            {sorted.length} pago{sorted.length !== 1 ? 's' : ''}{search.trim() ? ` encontrado${sorted.length !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {totalPages > 1 && (
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>Pág. {currentPage} / {totalPages}</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}>
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
            {search.trim() ? 'Sin resultados para esa búsqueda' : emptyText}
          </p>
        </div>
      ) : (
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(168,130,247,0.85)', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: '5px', border: '1px solid rgba(168,130,247,0.3)', background: 'rgba(168,130,247,0.08)' }}>
                    {billeteraLabel(p.source)}
                  </span>
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

                        {/* Dropdown de tiendas */}
                        <div ref={dropdownRef} style={{ position: 'relative' }}>
                          <button
                            type="button"
                            onClick={() => setManualState(s => ({ ...s, dropdownOpen: !s.dropdownOpen }))}
                            style={{
                              ...inputStyle, textAlign: 'left', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              color: ms.selectedStoreId ? 'rgba(226,232,240,0.9)' : 'rgba(148,163,184,0.4)',
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ms.selectedStoreId ? labelTiendaSeleccionada(ms) : 'Seleccionar tienda'}
                            </span>
                            <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.5, flexShrink: 0 }}>
                              {ms.dropdownOpen ? '▲' : '▼'}
                            </span>
                          </button>

                          {ms.dropdownOpen && (
                            <div style={{
                              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
                              background: '#0d1117', border: '1px solid rgba(0,212,255,0.2)',
                              borderRadius: '8px', overflow: 'hidden',
                              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            }}>
                              {/* Tiendas conectadas */}
                              {stores.map(store => (
                                <button
                                  key={store.storeId}
                                  type="button"
                                  onClick={() => setManualState(s => ({
                                    ...s,
                                    selectedStoreId: store.storeId,
                                    storeNameCustom: '',
                                    dropdownOpen: false,
                                  }))}
                                  style={{
                                    width: '100%', textAlign: 'left', padding: '8px 10px',
                                    fontSize: '12px', background: ms.selectedStoreId === store.storeId ? 'rgba(0,212,255,0.1)' : 'transparent',
                                    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    color: ms.selectedStoreId === store.storeId ? 'rgba(0,212,255,0.9)' : 'rgba(226,232,240,0.8)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {store.storeName}
                                </button>
                              ))}

                              {/* Separador + opción Otro */}
                              <div style={{ borderTop: stores.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                                <button
                                  type="button"
                                  onClick={() => setManualState(s => ({
                                    ...s,
                                    selectedStoreId: 'otro',
                                    dropdownOpen: false,
                                  }))}
                                  style={{
                                    width: '100%', textAlign: 'left', padding: '8px 10px',
                                    fontSize: '12px', background: ms.selectedStoreId === 'otro' ? 'rgba(148,163,184,0.08)' : 'transparent',
                                    border: 'none',
                                    color: ms.selectedStoreId === 'otro' ? 'rgba(148,163,184,0.8)' : 'rgba(148,163,184,0.5)',
                                    cursor: 'pointer', fontStyle: 'italic',
                                  }}
                                >
                                  ✎ Otro / texto libre
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Campo de texto libre cuando se eligió "Otro" */}
                        {ms.selectedStoreId === 'otro' && (
                          <input
                            style={inputStyle}
                            placeholder="Nombre de tienda o cliente..."
                            value={ms.storeNameCustom}
                            autoFocus
                            onChange={e => setManualState(s => ({ ...s, storeNameCustom: e.target.value }))}
                          />
                        )}

                        <input
                          style={inputStyle}
                          placeholder="Nro de orden (ej: 67521)"
                          value={ms.orderNumber}
                          onChange={e => setManualState(s => ({ ...s, orderNumber: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && puedeConfirmar(ms) && !ms.loading) handleManualConfirmForm() }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                        <button
                          onClick={handleManualConfirmForm}
                          disabled={!puedeConfirmar(ms) || ms.loading}
                          style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.08)', color: 'rgba(0,212,255,0.8)', cursor: (!puedeConfirmar(ms) || ms.loading) ? 'not-allowed' : 'pointer', opacity: (!puedeConfirmar(ms) || ms.loading) ? 0.4 : 1 }}>
                          {ms.loading ? 'Buscando en la tienda...' : 'Continuar →'}
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
                      {ms.isOtroMode ? (
                        /* Modo texto libre: confirmación directa sin validar */
                        <>
                          <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,212,255,0.8)', marginBottom: '6px' }}>
                            Confirmar registro
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                            Se registrará el pago con los datos ingresados sin marcar nada en TiendaNube.
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', marginBottom: '10px' }}>
                            Tienda: <span style={{ color: 'rgba(226,232,240,0.7)' }}>{ms.storeNameCustom || '—'}</span>
                            {' · '}Orden: <span style={{ color: 'rgba(226,232,240,0.7)' }}>{ms.orderNumber || '—'}</span>
                          </p>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => handleManualSubmit(p.mpPaymentId, false)} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.06)', color: 'rgba(0,212,255,0.7)', cursor: ms.loading ? 'not-allowed' : 'pointer', opacity: ms.loading ? 0.5 : 1 }}>
                              {ms.loading ? '...' : '✓ Confirmar'}
                            </button>
                            <button onClick={() => setManualState(s => ({ ...s, step: 'form' }))} disabled={ms.loading}
                              style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'rgba(148,163,184,0.3)', cursor: 'pointer' }}>
                              ← Volver
                            </button>
                          </div>
                        </>
                      ) : ms.matchedOrder ? (
                        /* Orden encontrada en la tienda seleccionada */
                        (() => {
                          const diffInfo = calcularDiff(p.monto, ms.matchedOrder.total)
                          const bloqueado = diffInfo !== null && !ms.confirmedDiff
                          return (
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
                            {diffInfo && (
                              <div style={{ padding: '8px 10px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: '8px', marginBottom: '10px', lineHeight: 1.5 }}>
                                <p style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>
                                  ⚠ Los montos no coinciden
                                </p>
                                <p style={{ fontSize: '11px', color: 'rgba(226,232,240,0.85)', marginBottom: '6px' }}>
                                  Pago: <strong>{ARS.format(p.monto)}</strong>{' · '}
                                  Orden: <strong>{ARS.format(ms.matchedOrder.total)}</strong>{' · '}
                                  Diferencia: <strong style={{ color: '#f87171' }}>{ARS.format(diffInfo.abs)}</strong>
                                  {' '}({diffInfo.paymentMenor ? 'pago es menor' : 'pago es mayor'})
                                </p>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '11px', color: 'rgba(248,113,113,0.9)' }}>
                                  <input
                                    type="checkbox"
                                    checked={ms.confirmedDiff}
                                    onChange={e => setManualState(s => ({ ...s, confirmedDiff: e.target.checked }))}
                                    style={{ marginTop: '2px', cursor: 'pointer' }}
                                  />
                                  <span>Sí, confirmo que la diferencia es correcta y quiero registrar el pago igual.</span>
                                </label>
                              </div>
                            )}
                            {!diffInfo && (
                              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                                ¿Marcar como pagada en TiendaNube y registrar el match?
                              </p>
                            )}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button onClick={() => handleManualSubmit(p.mpPaymentId, true)} disabled={ms.loading || bloqueado}
                                style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: (ms.loading || bloqueado) ? 'not-allowed' : 'pointer', opacity: (ms.loading || bloqueado) ? 0.4 : 1 }}>
                                {ms.loading ? '...' : '✓ Sí, marcar en TN'}
                              </button>
                              <button onClick={() => handleManualSubmit(p.mpPaymentId, false)} disabled={ms.loading || bloqueado}
                                style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.15)', background: 'transparent', color: 'rgba(148,163,184,0.5)', cursor: (ms.loading || bloqueado) ? 'not-allowed' : 'pointer', opacity: (ms.loading || bloqueado) ? 0.4 : 1 }}>
                                Solo registrar
                              </button>
                              <button onClick={() => setManualState(s => ({ ...s, step: 'form', confirmedDiff: false }))} disabled={ms.loading}
                                style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'rgba(148,163,184,0.3)', cursor: 'pointer' }}>
                                ← Volver
                              </button>
                            </div>
                          </>
                          )
                        })()
                      ) : (
                        /* Orden no encontrada en la tienda seleccionada */
                        <>
                          <p style={{ fontSize: '11px', color: 'rgba(255,180,0,0.7)', marginBottom: '6px' }}>
                            {ms.searchError
                              ? `⚠ Error al consultar la tienda: ${ms.searchError}`
                              : '⚠ No se encontró ninguna orden con ese número en esa tienda'}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '10px' }}>
                            Se registrará el pago con los datos ingresados sin marcar nada en TiendaNube.
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', marginBottom: '10px' }}>
                            Tienda: <span style={{ color: 'rgba(226,232,240,0.7)' }}>{resolverStoreName(ms) || '—'}</span>
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

      )}

      {/* Paginación */}
      {sorted.length > 0 && totalPages > 1 && (
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
