'use client'

import { useState, useMemo } from 'react'
import type { UnmatchedPayment, Order } from '@/lib/types'

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

function nameSim(a: string, b: string): number {
  if (!a || !b) return 0
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  if (na === nb) return 100
  const wa = na.split(/\s+/)
  const wb = nb.split(/\s+/)
  const shorter = wa.length <= wb.length ? wa : wb
  const longer = wa.length <= wb.length ? wb : wa
  const hits = shorter.filter(w => longer.some(l => l.includes(w) || w.includes(l)))
  return shorter.length ? Math.round((hits.length / shorter.length) * 100) : 0
}

type Payment = UnmatchedPayment['payment']

function computeScore(payment: Payment, order: Order): number {
  let score = 0
  const diff = Math.abs(payment.monto - order.total)
  if (diff === 0) score += 40
  else if (diff <= 10) score += 38
  else if (diff <= 100) score += 30
  else if (diff <= 500) score += 20
  else if (diff <= 1000) score += 10

  if (payment.cuitPagador && order.customerCuit) {
    const a = payment.cuitPagador.replace(/[-\s]/g, '')
    const b = order.customerCuit.replace(/[-\s]/g, '')
    if (a === b) score += 30
  }

  const ns = nameSim(payment.nombrePagador, order.customerName)
  score += Math.round(ns * 0.15)

  if (payment.emailPagador && order.customerEmail) {
    if (payment.emailPagador.toLowerCase() === order.customerEmail.toLowerCase()) score += 10
  }

  if (payment.fechaPago && order.createdAt) {
    const hourDiff = Math.abs(
      new Date(payment.fechaPago).getTime() - new Date(order.createdAt).getTime()
    ) / 3600000
    if (hourDiff <= 2) score += 5
    else if (hourDiff <= 24) score += 3
    else if (hourDiff <= 48) score += 1
  }

  return score
}

interface Signal {
  label: string
  value: string
  match: boolean
  partial: boolean
  unavailable: boolean
}

function computeSignals(payment: Payment, order: Order): Signal[] {
  const diff = Math.abs(payment.monto - order.total)
  const ns = nameSim(payment.nombrePagador, order.customerName)
  const hasCuit = !!(payment.cuitPagador && order.customerCuit)
  const cuitOk = hasCuit &&
    payment.cuitPagador.replace(/[-\s]/g, '') === order.customerCuit.replace(/[-\s]/g, '')
  const hasEmail = !!(payment.emailPagador && order.customerEmail)
  const emailOk = hasEmail &&
    payment.emailPagador.toLowerCase() === order.customerEmail.toLowerCase()
  const payTime = payment.fechaPago ? new Date(payment.fechaPago).getTime() : 0
  const ordTime = order.createdAt ? new Date(order.createdAt).getTime() : 0
  const hourDiff = payTime && ordTime ? Math.abs(payTime - ordTime) / 3600000 : 999

  return [
    {
      label: 'Monto',
      value: diff === 0 ? 'Exacto' : `Dif. ${ARS.format(diff)}`,
      match: diff <= 10, partial: diff <= 500, unavailable: false,
    },
    {
      label: 'CUIT / CUIL / DNI',
      value: !hasCuit ? 'No disponible' : cuitOk ? 'Coincide' : 'No coincide',
      match: cuitOk, partial: false, unavailable: !hasCuit,
    },
    {
      label: 'Nombre',
      value: (!payment.nombrePagador || !order.customerName)
        ? 'No disponible'
        : ns >= 70 ? 'Coincide' : ns >= 40 ? `Similar (${ns}%)` : 'No coincide',
      match: ns >= 70, partial: ns >= 40 && ns < 70, unavailable: !payment.nombrePagador || !order.customerName,
    },
    {
      label: 'Fecha / Hora',
      value: !payTime || !ordTime
        ? 'No disponible'
        : hourDiff <= 2 ? 'Cercano' : hourDiff <= 24 ? `~${Math.round(hourDiff)}h de dif.` : 'Lejano',
      match: hourDiff <= 2, partial: hourDiff <= 24, unavailable: !payTime || !ordTime,
    },
    {
      label: 'Email',
      value: !hasEmail ? 'No disponible' : emailOk ? 'Coincide' : 'No coincide',
      match: emailOk, partial: false, unavailable: !hasEmail,
    },
  ]
}

interface RankedOrder {
  order: Order
  score: number
  signals: Signal[]
}

interface Pair {
  payment: UnmatchedPayment
  id: string
  ranked: RankedOrder[]
  current: RankedOrder | null
  skipCount: number
}

interface Props {
  unmatchedPayments: UnmatchedPayment[]
  orders: Order[]
  onManualMatch: (mpPaymentId: string, orderId: string, storeId: string) => Promise<void>
  onDismissPayment: (mpPaymentId: string) => Promise<void>
  onMarkOrderPaid: (storeId: string, orderId: string) => Promise<void>
  onRefresh: () => void
  loading: boolean
}

export default function ManualMatchTab({
  unmatchedPayments,
  orders,
  onManualMatch,
  onDismissPayment,
  onRefresh,
  loading,
}: Props) {
  const [dismissedMap, setDismissedMap] = useState<Record<string, number>>({})

  const pairs: Pair[] = useMemo(() => {
    return unmatchedPayments.map(u => {
      const id = u.mpPaymentId || ''
      const skipCount = dismissedMap[id] ?? 0
      const ranked: RankedOrder[] = orders
        .map(o => ({
          order: o,
          score: computeScore(u.payment, o),
          signals: computeSignals(u.payment, o),
        }))
        .sort((a, b) => b.score - a.score)
      const current = ranked[skipCount] ?? null
      return { payment: u, id, ranked, current, skipCount }
    }).sort((a, b) => (b.current?.score ?? -1) - (a.current?.score ?? -1))
  }, [unmatchedPayments, orders, dismissedMap])

  const handleDismissPair = (paymentId: string) => {
    setDismissedMap(prev => ({ ...prev, [paymentId]: (prev[paymentId] ?? 0) + 1 }))
  }

  const handleConfirm = async (paymentId: string, orderId: string, storeId: string) => {
    await onManualMatch(paymentId, orderId, storeId)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
          {pairs.length} pago{pairs.length !== 1 ? 's' : ''} · {orders.length} orden{orders.length !== 1 ? 'es' : ''}
        </span>
        <button
          onClick={onRefresh}
          style={{
            fontSize: '13px',
            fontWeight: 600,
            padding: '7px 18px',
            borderRadius: '9px',
            border: '1px solid rgba(0,212,255,0.2)',
            background: 'rgba(0,212,255,0.05)',
            color: 'rgba(0,212,255,0.65)',
            cursor: 'pointer',
            transition: 'all 0.15s',
            letterSpacing: '0.04em',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'rgba(0,212,255,0.1)'
            el.style.color = '#00d4ff'
            el.style.borderColor = 'rgba(0,212,255,0.35)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'rgba(0,212,255,0.05)'
            el.style.color = 'rgba(0,212,255,0.65)'
            el.style.borderColor = 'rgba(0,212,255,0.2)'
          }}
        >
          ↻ Reevaluar
        </button>
      </div>

      {/* Column labels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px 1fr', gap: '8px', padding: '0 20px' }}>
        {[
          { label: 'PAGOS', align: 'left' as const },
          { label: 'COINCIDENCIAS', align: 'center' as const },
          { label: 'ORDENES', align: 'right' as const },
        ].map(h => (
          <div
            key={h.label}
            style={{
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.2em',
              color: 'rgba(0,212,255,0.5)', textAlign: h.align,
            }}
          >
            {h.label}
          </div>
        ))}
      </div>

      {/* One pair at a time */}
      {pairs.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-2xl py-16"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>No hay pagos pendientes</p>
        </div>
      ) : (
        <PairRow
          key={pairs[0].id}
          pair={pairs[0]}
          onConfirm={handleConfirm}
          onDismissPair={handleDismissPair}
          onDismissPayment={onDismissPayment}
          loading={loading}
        />
      )}
    </div>
  )
}

function PairRow({
  pair,
  onConfirm,
  onDismissPair,
  onDismissPayment,
  loading,
}: {
  pair: Pair
  onConfirm: (paymentId: string, orderId: string, storeId: string) => void
  onDismissPair: (paymentId: string) => void
  onDismissPayment: (paymentId: string) => void
  loading: boolean
}) {
  const { payment, id, current } = pair
  const p = payment.payment

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px 1fr',
        gap: '0',
        background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)',
        border: '1px solid rgba(0,212,255,0.09)',
        borderRadius: '16px',
        overflow: 'hidden',
      }}
    >
      {/* PAGO */}
      <div style={{ padding: '28px 32px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
        <p style={{ fontSize: '38px', fontWeight: 800, color: 'white', marginBottom: '12px', letterSpacing: '-0.03em', lineHeight: 1 }}>
          {ARS.format(p.monto)}
        </p>
        {p.cuitPagador && (
          <p style={{ fontSize: '15px', color: 'rgba(0,212,255,0.7)', fontWeight: 600, marginBottom: '6px' }}>
            CUIT/DNI: {p.cuitPagador}
          </p>
        )}
        {p.nombrePagador
          ? <p style={{ fontSize: '20px', color: 'rgba(226,232,240,0.9)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombrePagador}</p>
          : <p style={{ fontSize: '18px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '6px' }}>Sin nombre</p>
        }
        <p style={{ fontSize: '14px', color: 'rgba(148,163,184,0.5)', marginBottom: '4px' }}>{fmtDate(p.fechaPago)}</p>
        {p.emailPagador && (
          <p style={{ fontSize: '14px', color: 'rgba(148,163,184,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.emailPagador}
          </p>
        )}
      </div>

      {/* COINCIDENCIAS */}
      <div
        style={{
          padding: '24px 22px',
          borderRight: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'rgba(0,212,255,0.018)',
        }}
      >
        {current ? (
          <>
            {current.signals.map(sig => {
              const color = sig.unavailable
                ? 'rgba(148,163,184,0.3)'
                : sig.match ? '#00ff88'
                : sig.partial ? '#f59e0b'
                : '#f87171'
              const dot = sig.unavailable ? '·' : sig.match ? '✓' : sig.partial ? '~' : '✗'
              return (
                <div key={sig.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.45)', flexShrink: 0 }}>{sig.label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color, whiteSpace: 'nowrap' }}>{dot} {sig.value}</span>
                </div>
              )
            })}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={() => onConfirm(id, current.order.orderId, current.order.storeId)}
                disabled={loading}
                style={{
                  padding: '12px 0',
                  borderRadius: '10px',
                  border: '1px solid rgba(0,255,136,0.3)',
                  background: 'rgba(0,255,136,0.08)',
                  color: '#00ff88',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  width: '100%',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,136,0.14)' } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,136,0.08)' }}
              >
                ✓ Confirmar pago
              </button>
              <button
                onClick={() => onDismissPair(id)}
                disabled={loading}
                style={{
                  padding: '9px 0',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent',
                  color: 'rgba(148,163,184,0.5)',
                  fontSize: '14px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  width: '100%',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.color = 'rgba(248,113,113,0.75)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.25)' } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(148,163,184,0.5)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)' }}
              >
                No corresponde
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '8px 0' }}>
            <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.3)', textAlign: 'center', lineHeight: '1.6' }}>
              Sin más<br />órdenes disponibles
            </p>
            <button
              onClick={() => onDismissPayment(id)}
              disabled={loading}
              style={{
                fontSize: '13px',
                padding: '8px 16px',
                borderRadius: '9px',
                border: '1px solid rgba(248,113,113,0.2)',
                color: 'rgba(248,113,113,0.6)',
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Eliminar pago
            </button>
          </div>
        )}
      </div>

      {/* ORDEN */}
      <div style={{ padding: '28px 32px' }}>
        {current ? (
          <>
            <p style={{ fontSize: '38px', fontWeight: 800, color: 'white', marginBottom: '12px', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {ARS.format(current.order.total)}
            </p>
            {current.order.customerCuit && (
              <p style={{ fontSize: '15px', color: 'rgba(0,212,255,0.7)', fontWeight: 600, marginBottom: '6px' }}>
                CUIT/DNI: {current.order.customerCuit}
              </p>
            )}
            {current.order.customerName
              ? <p style={{ fontSize: '20px', color: 'rgba(226,232,240,0.9)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.order.customerName}</p>
              : <p style={{ fontSize: '18px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '6px' }}>Sin nombre</p>
            }
            <p style={{ fontSize: '14px', color: 'rgba(148,163,184,0.5)', marginBottom: '4px' }}>{fmtDate(current.order.createdAt)}</p>
            {current.order.customerEmail && (
              <p style={{ fontSize: '14px', color: 'rgba(148,163,184,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '8px' }}>
                {current.order.customerEmail}
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#00d4ff' }}>#{current.order.orderNumber}</span>
              {current.order.storeName && (
                <span style={{ fontSize: '14px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {current.order.storeName}
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <span style={{ fontSize: '16px', color: 'rgba(148,163,184,0.2)' }}>—</span>
          </div>
        )}
      </div>
    </div>
  )
}
