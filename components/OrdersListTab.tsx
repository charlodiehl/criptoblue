'use client'

import { useState, useMemo } from 'react'
import MontoInput from '@/components/MontoInput'
import type { Order, Store } from '@/lib/types'
import { ARS, fmtDate, matchesSearch } from '@/lib/utils'
import { MONTO_DIFF_WARNING_THRESHOLD, WALLETS } from '@/lib/config'

const PAGE_SIZE = 100

interface ManualPayForm {
  medioPago: string
  billetera: string        // billetera a la que va el pago (WALLETS) o '' = medio de pago
  billeteraOtra: string    // nombre libre si billetera === 'Otras'
  monto: string
  nombrePagador: string
  cuitPagador: string
  fechaPago: string
  loading: boolean
  confirmedDiff: boolean   // tildado por el operador para aceptar diferencia de monto
}

// Calcula la diferencia entre lo ingresado y el total de la orden.
// Devuelve null si la diferencia está dentro del umbral aceptable.
function calcularDiffMonto(montoRaw: string, orderTotal: number) {
  const monto = parseFloat(montoRaw.replace(',', '.'))
  if (!Number.isFinite(monto) || monto <= 0) return null
  if (!orderTotal || orderTotal <= 0) return null
  const diff = monto - orderTotal
  const abs = Math.abs(diff)
  if (abs <= MONTO_DIFF_WARNING_THRESHOLD) return null
  return { diff, abs, monto, orderTotal, paymentMenor: diff < 0 }
}

interface DuplicateInfo {
  order: Order
  confidence: 'alta' | 'media'
}

interface BuscarOrdenResult {
  order: Order
  paymentStatus: string
  orderStatus: string
  alreadyInCache: boolean
  logDuplicate?: { orderNumber: string; storeName: string; timestamp: string; confidence: 'alta' | 'media' } | null
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const campoBillStyle: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }
const campoBillLabel: React.CSSProperties = { fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }

// Selector de billetera del pago (para el marcado manual). Elegí una de las
// billeteras del sistema, u "Otras" con un nombre libre para pagos que no entraron
// por ninguna. El pago queda atribuido a esa billetera en Administración Financiera.
function SelectorBilletera({ form, onChange }: { form: ManualPayForm; onChange: (patch: Partial<ManualPayForm>) => void }) {
  return (
    <div>
      <label style={campoBillLabel}>Billetera del pago</label>
      <select value={form.billetera} onChange={e => onChange({ billetera: e.target.value })}
        style={{ ...campoBillStyle, colorScheme: 'dark' }}>
        <option value="" style={{ background: '#1a2235' }}>— Sin billetera —</option>
        {WALLETS.map(w => <option key={w} value={w} style={{ background: '#1a2235' }}>{w}</option>)}
      </select>
      {form.billetera === 'Otras' && (
        <input type="text" placeholder="Nombre de la billetera (ej: Ualá, Efectivo)"
          value={form.billeteraOtra} onChange={e => onChange({ billeteraOtra: e.target.value })}
          style={{ ...campoBillStyle, marginTop: '6px' }} />
      )}
    </div>
  )
}

interface Props {
  orders: Order[]
  stores?: Store[]
  matchedIds?: Set<string>
  duplicateMap?: Map<string, DuplicateInfo>
  onMarkExternal?: (orderId: string, storeId: string) => Promise<void>
  onMarkManual?: (orderId: string, storeId: string, monto: number, medioPago: string, nombrePagador: string, order: Order, cuitPagador?: string, fechaPago?: string, billetera?: string, billeteraOtra?: string) => Promise<void>
  loading?: boolean
}

export default function OrdersListTab({ orders, stores, matchedIds, duplicateMap, onMarkExternal, onMarkManual, loading }: Props) {
  const [page, setPage] = useState(1)
  const [marking, setMarking] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<string | null>(null)
  const [manualForm, setManualForm] = useState<ManualPayForm>({ medioPago: '', billetera: '', billeteraOtra: '', monto: '', nombrePagador: '', cuitPagador: '', fechaPago: '', loading: false, confirmedDiff: false })
  const [search, setSearch] = useState('')

  // Estado del modal "Validar orden antigua"
  const [validarOpen, setValidarOpen] = useState(false)
  const [validarOrderNumber, setValidarOrderNumber] = useState('')
  const [validarStoreId, setValidarStoreId] = useState('')
  const [validarLoading, setValidarLoading] = useState(false)
  const [validarError, setValidarError] = useState<string | null>(null)
  const [validarResult, setValidarResult] = useState<BuscarOrdenResult | null>(null)
  const [validarManualOpen, setValidarManualOpen] = useState(false)
  const [validarManualForm, setValidarManualForm] = useState<ManualPayForm>({ medioPago: '', billetera: '', billeteraOtra: '', monto: '', nombrePagador: '', cuitPagador: '', fechaPago: '', loading: false, confirmedDiff: false })

  const openValidar = () => {
    setValidarOpen(true)
    setValidarOrderNumber('')
    setValidarStoreId(stores?.[0]?.storeId || '')
    setValidarError(null)
    setValidarResult(null)
    setValidarManualOpen(false)
  }

  const handleBuscarOrden = async () => {
    if (!validarOrderNumber.trim() || !validarStoreId) return
    setValidarLoading(true)
    setValidarError(null)
    setValidarResult(null)
    setValidarManualOpen(false)
    try {
      const res = await fetch('/api/buscar-orden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: validarOrderNumber.trim(), storeId: validarStoreId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setValidarError(data.error || 'Error al buscar la orden')
        return
      }
      if (data.notFound) {
        setValidarError('No se encontró ninguna orden con ese número en la tienda seleccionada.')
        return
      }
      // Advertencia si está cancelada o ya pagada (no bloquea, igual muestra la orden)
      const ps = (data.paymentStatus || '').toLowerCase()
      const os = (data.orderStatus || '').toLowerCase()
      if (os === 'cancelled') {
        setValidarError('⚠ Esta orden está cancelada.')
      } else if (ps === 'paid') {
        setValidarError('⚠ Esta orden ya está marcada como pagada.')
      }
      setValidarResult(data)
      if (data.order) {
        setValidarManualForm({
          medioPago: '',
          billetera: '', billeteraOtra: '',
          monto: String(data.order.total),
          nombrePagador: data.order.customerName || '',
          cuitPagador: data.order.customerCuit || '',
          fechaPago: toDatetimeLocal(new Date()),
          loading: false,
          confirmedDiff: false,
        })
      }
    } catch (err) {
      setValidarError(String(err))
    } finally {
      setValidarLoading(false)
    }
  }

  const handleValidarManualSubmit = async () => {
    if (!onMarkManual || !validarResult?.order || validarManualForm.loading) return
    const monto = parseFloat(validarManualForm.monto.replace(',', '.'))
    if (!validarManualForm.medioPago.trim() || isNaN(monto) || monto <= 0) return
    setValidarManualForm(f => ({ ...f, loading: true }))
    try {
      const o = validarResult.order
      await onMarkManual(
        o.orderId, o.storeId, monto,
        validarManualForm.medioPago.trim(),
        validarManualForm.nombrePagador.trim(),
        o,
        validarManualForm.cuitPagador.trim() || undefined,
        validarManualForm.fechaPago || undefined,
        validarManualForm.billetera || undefined,
        validarManualForm.billeteraOtra.trim() || undefined,
      )
      setValidarOpen(false)
    } finally {
      setValidarManualForm(f => ({ ...f, loading: false }))
    }
  }

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
    setManualForm({ medioPago: '', billetera: '', billeteraOtra: '', monto: String(orderTotal), nombrePagador: '', cuitPagador: '', fechaPago: toDatetimeLocal(new Date()), loading: false, confirmedDiff: false })
  }

  const handleManualSubmit = async (o: Order) => {
    if (!onMarkManual || manualForm.loading) return
    const monto = parseFloat(manualForm.monto.replace(',', '.'))
    if (!manualForm.medioPago.trim() || isNaN(monto) || monto <= 0) return
    setManualForm(f => ({ ...f, loading: true }))
    try {
      await onMarkManual(o.orderId, o.storeId, monto, manualForm.medioPago.trim(), manualForm.nombrePagador.trim(), o, manualForm.cuitPagador.trim() || undefined, manualForm.fechaPago || undefined, manualForm.billetera || undefined, manualForm.billeteraOtra.trim() || undefined)
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

  return (
    <div>
      {/* Botón Validar orden antigua */}
      {onMarkManual && stores && stores.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <button
            onClick={openValidar}
            style={{
              fontSize: '12px', fontWeight: 600, padding: '7px 14px', borderRadius: '8px',
              border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.07)',
              color: 'rgba(251,191,36,0.8)', cursor: 'pointer', letterSpacing: '0.02em',
            }}
          >
            🔍 Validar orden antigua
          </button>
        </div>
      )}

      {/* Modal Validar orden antigua */}
      {validarOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }} onClick={e => { if (e.target === e.currentTarget) setValidarOpen(false) }}>
          <div style={{
            background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)',
            border: '1px solid rgba(251,191,36,0.2)', borderRadius: '16px',
            padding: '24px', width: '100%', maxWidth: '420px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(251,191,36,0.9)', letterSpacing: '0.04em' }}>
                Validar orden antigua
              </span>
              <button onClick={() => setValidarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.5)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
            </div>

            {/* Formulario de búsqueda */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              {stores && stores.length > 1 && (
                <div>
                  <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Tienda</label>
                  <select
                    value={validarStoreId}
                    onChange={e => { setValidarStoreId(e.target.value); setValidarResult(null); setValidarError(null) }}
                    style={{ width: '100%', background: '#1a2235', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'rgba(226,232,240,0.9)', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
                  >
                    {stores.map(s => <option key={s.storeId} value={s.storeId}>{s.storeName}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Número de orden</label>
                <input
                  type="text"
                  placeholder="Ej: 300354"
                  value={validarOrderNumber}
                  onChange={e => { setValidarOrderNumber(e.target.value); setValidarResult(null); setValidarError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleBuscarOrden() }}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button
                onClick={handleBuscarOrden}
                disabled={validarLoading || !validarOrderNumber.trim() || !validarStoreId}
                style={{
                  fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '7px',
                  border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.08)',
                  color: 'rgba(0,212,255,0.85)', cursor: 'pointer',
                  opacity: (validarLoading || !validarOrderNumber.trim() || !validarStoreId) ? 0.4 : 1,
                }}
              >
                {validarLoading ? 'Buscando...' : 'Buscar orden'}
              </button>
            </div>

            {/* Error / Advertencia */}
            {validarError && (
              <div style={{
                padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '10px',
                ...(validarError.startsWith('⚠')
                  ? { background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: 'rgba(251,191,36,0.9)' }
                  : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.85)' }
                )
              }}>
                {validarError}
              </div>
            )}

            {/* Resultado */}
            {validarResult && (
              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: '10px', padding: '14px', marginBottom: '10px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '22px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>
                    {ARS.format(validarResult.order.total)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#00d4ff' }}>#{validarResult.order.orderNumber}</span>
                  <span style={{ fontSize: '10px', color: 'rgba(148,163,184,0.45)' }}>{validarResult.order.storeName}</span>
                </div>
                {validarResult.order.customerName && (
                  <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px' }}>{validarResult.order.customerName}</p>
                )}
                {validarResult.order.customerCuit && (
                  <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.6)', marginBottom: '3px' }}>CUIT/DNI: {validarResult.order.customerCuit}</p>
                )}
                {validarResult.order.customerEmail && (
                  <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>{validarResult.order.customerEmail}</p>
                )}
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '8px' }}>{fmtDate(validarResult.order.createdAt)}</p>
                {validarResult.alreadyInCache && (
                  <div style={{ padding: '5px 9px', background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '6px', fontSize: '11px', color: 'rgba(0,212,255,0.6)', marginBottom: '8px' }}>
                    Esta orden ya aparece en el flujo activo de órdenes pendientes.
                  </div>
                )}

                {/* Aviso de duplicado en historial 30 días */}
                {validarResult.logDuplicate && (
                  <div style={{ padding: '8px 12px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', fontSize: '12px', color: 'rgba(251,191,36,0.95)', marginBottom: '8px', lineHeight: 1.5 }}>
                    ⚠ Posible duplicado · Orden #{validarResult.logDuplicate.orderNumber} con mismo{' '}
                    {validarResult.logDuplicate.confidence === 'alta' ? 'cliente y monto' : 'nombre y monto'}{' '}
                    ya fue marcada el {fmtDate(validarResult.logDuplicate.timestamp)}
                  </div>
                )}

                {/* Botón abrir form manual — solo si no está cancelada ni pagada */}
                {!validarManualOpen && !validarError?.startsWith('⚠') && (
                  <button
                    onClick={() => setValidarManualOpen(true)}
                    style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: 'rgba(148,163,184,0.55)', cursor: 'pointer' }}
                  >
                    ✎ Marcar manualmente
                  </button>
                )}

                {/* Formulario de marcado manual */}
                {validarManualOpen && (
                  <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.1)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Medio de pago *</label>
                        <input type="text" placeholder="Ej: MercadoPago, Transferencia, Efectivo"
                          value={validarManualForm.medioPago}
                          onChange={e => setValidarManualForm(f => ({ ...f, medioPago: e.target.value }))}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <SelectorBilletera form={validarManualForm} onChange={patch => setValidarManualForm(f => ({ ...f, ...patch }))} />
                      <div>
                        <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Monto recibido *</label>
                        <MontoInput placeholder="0"
                          value={validarManualForm.monto}
                          onChange={v => setValidarManualForm(f => ({ ...f, monto: v, confirmedDiff: false }))}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Nombre pagador</label>
                        <input type="text" placeholder="Opcional"
                          value={validarManualForm.nombrePagador}
                          onChange={e => setValidarManualForm(f => ({ ...f, nombrePagador: e.target.value }))}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>CUIT / DNI pagador</label>
                        <input type="text" placeholder="Opcional"
                          value={validarManualForm.cuitPagador}
                          onChange={e => setValidarManualForm(f => ({ ...f, cuitPagador: e.target.value }))}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Fecha y hora del pago *</label>
                        <input type="datetime-local"
                          value={validarManualForm.fechaPago}
                          onChange={e => setValidarManualForm(f => ({ ...f, fechaPago: e.target.value }))}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
                        />
                      </div>
                      {(() => {
                        const diffInfo = calcularDiffMonto(validarManualForm.monto, validarResult.order.total)
                        const bloqueado = diffInfo !== null && !validarManualForm.confirmedDiff
                        const baseDisabled = validarManualForm.loading || !validarManualForm.medioPago.trim() || !validarManualForm.monto
                        return (
                          <>
                            {diffInfo && (
                              <div style={{ padding: '8px 10px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: '8px', marginTop: '4px', lineHeight: 1.5 }}>
                                <p style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>
                                  ⚠ El monto no coincide con el total de la orden
                                </p>
                                <p style={{ fontSize: '11px', color: 'rgba(226,232,240,0.85)', marginBottom: '6px' }}>
                                  Monto: <strong>{ARS.format(diffInfo.monto)}</strong>{' · '}
                                  Orden: <strong>{ARS.format(diffInfo.orderTotal)}</strong>{' · '}
                                  Diferencia: <strong style={{ color: '#f87171' }}>{ARS.format(diffInfo.abs)}</strong>
                                  {' '}({diffInfo.paymentMenor ? 'monto es menor' : 'monto es mayor'})
                                </p>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '11px', color: 'rgba(248,113,113,0.9)' }}>
                                  <input
                                    type="checkbox"
                                    checked={validarManualForm.confirmedDiff}
                                    onChange={e => setValidarManualForm(f => ({ ...f, confirmedDiff: e.target.checked }))}
                                    style={{ marginTop: '2px', cursor: 'pointer' }}
                                  />
                                  <span>Sí, confirmo que la diferencia es correcta y quiero registrar el pago igual.</span>
                                </label>
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                              <button
                                onClick={handleValidarManualSubmit}
                                disabled={baseDisabled || bloqueado}
                                style={{ flex: 1, fontSize: '12px', fontWeight: 700, padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: (baseDisabled || bloqueado) ? 'not-allowed' : 'pointer', opacity: (baseDisabled || bloqueado) ? 0.4 : 1 }}
                              >
                                {validarManualForm.loading ? '...' : 'Confirmar'}
                              </button>
                              <button
                                onClick={() => setValidarManualOpen(false)}
                                style={{ fontSize: '12px', padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.15)', background: 'transparent', color: 'rgba(148,163,184,0.5)', cursor: 'pointer' }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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

      {sorted.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
            {search.trim() ? 'Sin resultados para esa búsqueda' : 'No hay órdenes en las últimas 48hs'}
          </p>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: '10px' }}>
        {pageItems.map(o => {
          const key = `${o.storeId}-${o.orderId}`
          const matched = matchedIds?.has(key)
          const isMarking = marking === key
          const dupInfo = duplicateMap?.get(key)
          const dupAlreadyMarked = dupInfo ? matchedIds?.has(`${dupInfo.order.storeId}-${dupInfo.order.orderId}`) : false
          const isCancelled = ['cancelled', 'archived', 'closed'].includes((o.orderStatus || '').toLowerCase())
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
                {!matched && dupInfo && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em', textShadow: '0 0 8px rgba(251,191,36,0.3)' }}>
                    ⚠ POSIBLE DUPLICADO
                  </span>
                )}
                {!matched && isCancelled && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#f87171', letterSpacing: '0.04em', textShadow: '0 0 8px rgba(248,113,113,0.3)' }}>
                    ✕ CANCELADA
                  </span>
                )}
              </div>
              {isCancelled && (
                <div style={{ marginBottom: '6px', padding: '5px 9px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: '7px', fontSize: '11px', color: 'rgba(248,113,113,0.8)', lineHeight: 1.4 }}>
                  Esta orden está cancelada en TiendaNube
                </div>
              )}
              {dupInfo && (
                <div style={{ marginBottom: '6px', padding: '5px 9px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: '7px', fontSize: '11px', color: 'rgba(251,191,36,0.8)', lineHeight: 1.4 }}>
                  Orden #{dupInfo.order.orderNumber} con mismo{' '}
                  {dupInfo.confidence === 'alta' ? 'cliente y monto' : 'nombre y monto'}{' '}
                  {dupAlreadyMarked && <span style={{ fontWeight: 700, color: '#fbbf24' }}>· la otra ya está MARCADA</span>}
                </div>
              )}
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
                    <SelectorBilletera form={manualForm} onChange={patch => setManualForm(f => ({ ...f, ...patch }))} />
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Monto recibido *</label>
                      <MontoInput
                        placeholder="0"
                        value={manualForm.monto}
                        onChange={v => setManualForm(f => ({ ...f, monto: v, confirmedDiff: false }))}
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
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>CUIT / DNI pagador</label>
                      <input
                        type="text"
                        placeholder="Opcional"
                        value={manualForm.cuitPagador}
                        onChange={e => setManualForm(f => ({ ...f, cuitPagador: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Fecha y hora del pago *</label>
                      <input
                        type="datetime-local"
                        value={manualForm.fechaPago}
                        onChange={e => setManualForm(f => ({ ...f, fechaPago: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: 'white', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
                      />
                    </div>
                    {(() => {
                      const diffInfo = calcularDiffMonto(manualForm.monto, o.total)
                      const bloqueado = diffInfo !== null && !manualForm.confirmedDiff
                      const baseDisabled = manualForm.loading || !manualForm.medioPago.trim() || !manualForm.monto
                      return (
                        <>
                          {diffInfo && (
                            <div style={{ padding: '8px 10px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: '8px', marginTop: '4px', lineHeight: 1.5 }}>
                              <p style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>
                                ⚠ El monto no coincide con el total de la orden
                              </p>
                              <p style={{ fontSize: '11px', color: 'rgba(226,232,240,0.85)', marginBottom: '6px' }}>
                                Monto: <strong>{ARS.format(diffInfo.monto)}</strong>{' · '}
                                Orden: <strong>{ARS.format(diffInfo.orderTotal)}</strong>{' · '}
                                Diferencia: <strong style={{ color: '#f87171' }}>{ARS.format(diffInfo.abs)}</strong>
                                {' '}({diffInfo.paymentMenor ? 'monto es menor' : 'monto es mayor'})
                              </p>
                              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '11px', color: 'rgba(248,113,113,0.9)' }}>
                                <input
                                  type="checkbox"
                                  checked={manualForm.confirmedDiff}
                                  onChange={e => setManualForm(f => ({ ...f, confirmedDiff: e.target.checked }))}
                                  style={{ marginTop: '2px', cursor: 'pointer' }}
                                />
                                <span>Sí, confirmo que la diferencia es correcta y quiero registrar el pago igual.</span>
                              </label>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                            <button
                              onClick={() => handleManualSubmit(o)}
                              disabled={baseDisabled || bloqueado}
                              style={{ flex: 1, fontSize: '12px', fontWeight: 700, padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: (baseDisabled || bloqueado) ? 'not-allowed' : 'pointer', opacity: (baseDisabled || bloqueado) ? 0.4 : 1 }}
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
                        </>
                      )
                    })()}
                  </div>
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
