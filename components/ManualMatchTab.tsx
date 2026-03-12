'use client'

import { useState, useMemo, useEffect } from 'react'
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

function computeScore(payment: Payment, order: Order, sameMontoCount = -1): number {
  let score = 0

  // Monto
  const diff = Math.abs(payment.monto - order.total)
  if (diff === 0) score += 20
  else if (diff <= 10) score += 19
  else if (diff <= 1000) score += 17
  else score += 15

  // CUIT / CUIL / DNI
  if (payment.cuitPagador && order.customerCuit) {
    if (cuitMatch(payment.cuitPagador, order.customerCuit)) score += 100
  }

  // Email exacto
  if (payment.emailPagador && order.customerEmail) {
    if (payment.emailPagador.toLowerCase() === order.customerEmail.toLowerCase()) score += 90
  }

  // Reconoce nombre en email (pago sin nombre, email coincide con nombre de orden)
  if (!payment.nombrePagador && payment.emailPagador && order.customerName) {
    if (emailMatchesName(payment.emailPagador, order.customerName)) score += 80
  }

  // Nombre (solo cuando el pago tiene nombre)
  if (payment.nombrePagador && order.customerName) {
    const ns = nameSim(payment.nombrePagador, order.customerName)
    if (ns >= 70) score += 50        // nombre exacto / muy similar
    else if (ns >= 40) score += 10   // nombre parcial
    // < 40 → +0
  }

  // Encuentra nombre en email (cuando el pago SÍ tiene nombre, email da cruce adicional)
  if (payment.nombrePagador) {
    const emailCross =
      (payment.emailPagador ? emailMatchesName(payment.emailPagador, order.customerName) : false) ||
      (order.customerEmail ? emailMatchesName(order.customerEmail, payment.nombrePagador) : false)
    if (emailCross) score += 10
  }

  // Fecha / Hora: +20 exacto, -0.01 por minuto, 0 si > 12h o pago antes de la orden
  if (payment.fechaPago && order.createdAt) {
    const payTime = new Date(payment.fechaPago).getTime()
    const ordTime = new Date(order.createdAt).getTime()
    const diffMin = (payTime - ordTime) / 60000 // positivo = pago después de la orden
    if (diffMin >= 0 && diffMin <= 720) {
      score += Math.max(0, 20 - 0.01 * diffMin)
    }
    // diffMin < 0 (pago antes) o > 720 → +0
  }

  // Unicidad de monto: única orden con este monto → +1
  if (sameMontoCount === 0) score += 1

  return score
}

interface Signal {
  label: string
  value: string
  match: boolean
  partial: boolean
  unavailable: boolean
  timeMinutes?: number
}

function extractDniDigits(s: string): string {
  const d = s.replace(/\D/g, '')
  return d.length === 11 ? d.slice(2, 10) : d
}

function cuitMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '')
  const db = b.replace(/\D/g, '')
  if (!da || !db) return false
  if (da === db) return true
  if (da.length === 11 && extractDniDigits(da) === db) return true
  if (db.length === 11 && extractDniDigits(db) === da) return true
  const [shorter, longer] = da.length <= db.length ? [da, db] : [db, da]
  return shorter.length >= 6 && longer.includes(shorter)
}

function emailLocalTokens(email: string): string[] {
  return (email.split('@')[0] || '').toLowerCase().replace(/[^a-z]/g, ' ').split(' ').filter(t => t.length >= 3)
}

function emailMatchesName(email: string, name: string): boolean {
  const et = emailLocalTokens(email)
  if (!et.length) return false
  const nt = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ' ').split(' ').filter(t => t.length >= 3)
  return et.some(e => nt.some(n => e === n || (e.length > 3 && n.length > 3 && e.slice(0, 4) === n.slice(0, 4))))
}

function computeSignals(payment: Payment, order: Order): Signal[] {
  const diff = Math.abs(payment.monto - order.total)
  const ns = nameSim(payment.nombrePagador, order.customerName)
  const hasCuit = !!(payment.cuitPagador && order.customerCuit)
  const cuitOk = hasCuit && cuitMatch(payment.cuitPagador, order.customerCuit)
  const hasEmail = !!(payment.emailPagador && order.customerEmail)
  const emailExact = hasEmail && payment.emailPagador.toLowerCase() === order.customerEmail.toLowerCase()
  const emailCross = !emailExact && (
    (payment.emailPagador ? emailMatchesName(payment.emailPagador, order.customerName) : false) ||
    (order.customerEmail ? emailMatchesName(order.customerEmail, payment.nombrePagador) : false)
  )

  const payTime = payment.fechaPago ? new Date(payment.fechaPago).getTime() : 0
  const ordTime = order.createdAt ? new Date(order.createdAt).getTime() : 0
  const minDiff = payTime && ordTime ? Math.round(Math.abs(payTime - ordTime) / 60000) : -1

  const timeValue = minDiff < 0 ? 'No disponible'
    : minDiff < 60 ? `${minDiff} min`
    : `${Math.round(minDiff / 60)}h ${minDiff % 60}min`

  const nameViaEmail = !payment.nombrePagador && !!payment.emailPagador && !!order.customerName
    ? emailMatchesName(payment.emailPagador, order.customerName)
    : false

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
      value: nameViaEmail
        ? 'coincide con email'
        : (!payment.nombrePagador || !order.customerName)
          ? 'No disponible'
          : ns >= 70 ? 'Coincide' : ns >= 40 ? `Similar (${ns}%)` : 'No coincide',
      match: ns >= 70,
      partial: (ns >= 40 && ns < 70) || nameViaEmail,
      unavailable: !nameViaEmail && (!payment.nombrePagador || !order.customerName),
    },
    {
      label: 'Fecha / Hora',
      value: timeValue,
      match: minDiff >= 0 && minDiff <= 15,
      partial: minDiff > 15 && minDiff <= 180,
      unavailable: minDiff < 0,
      timeMinutes: minDiff,
    },
    {
      label: 'Email',
      value: !hasEmail ? 'No disponible' : emailExact ? 'Coincide' : emailCross ? 'Nombre en email' : 'No coincide',
      match: emailExact, partial: emailCross, unavailable: !hasEmail,
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
  onCancelDuplicate: (storeId: string, orderId: string) => Promise<void>
  loading: boolean
  lastMPCheck: string | null
  refreshKey: number
}

export default function ManualMatchTab({
  unmatchedPayments,
  orders,
  onManualMatch,
  onDismissPayment,
  onCancelDuplicate,
  loading,
  lastMPCheck,
  refreshKey,
}: Props) {
  const [dismissedMap, setDismissedMap] = useState<Record<string, number>>({})

  useEffect(() => {
    setDismissedMap({})
  }, [refreshKey])

  const pairs: Pair[] = useMemo(() => {
    // Build all scores
    const allPairs = unmatchedPayments.map(u => {
      const id = u.mpPaymentId || ''
      const skipCount = dismissedMap[id] ?? 0
      // Precomputar cantidad de órdenes con mismo monto (una sola vez por pago)
      const totalSameMonto = orders.filter(x => x.total === u.payment.monto).length

      const ranked: RankedOrder[] = orders
        .filter(o => {
          if (!u.payment.fechaPago || !o.createdAt) return true
          const payTime = new Date(u.payment.fechaPago).getTime()
          const ordTime = new Date(o.createdAt).getTime()
          // Nunca emparejar un pago con una orden que no existía cuando llegó el pago
          return payTime >= ordTime
        })
        .map(o => {
          const signals = computeSignals(u.payment, o)
          const sameMontoCount = totalSameMonto - (o.total === u.payment.monto ? 1 : 0)
          // Mostrar señal solo cuando monto es el ÚNICO factor verde
          const montoGreen = signals[0].match
          const anyOtherGreen = signals.slice(1).some(s => s.match)
          if (montoGreen && !anyOtherGreen) {
            signals.push({
              label: 'Otras órdenes mismo monto',
              value: sameMontoCount === 0 ? 'Única' : `${sameMontoCount} orden${sameMontoCount !== 1 ? 'es' : ''}`,
              match: sameMontoCount === 0,
              partial: sameMontoCount >= 1 && sameMontoCount <= 2,
              unavailable: false,
            })
          }
          return { order: o, score: computeScore(u.payment, o, sameMontoCount), signals }
        })
        .sort((a, b) => b.score - a.score)
      return { payment: u, id, ranked, skipCount }
    })

    // Greedy unique assignment: each order assigned to at most one payment
    const usedOrderIds = new Set<string>()
    const result: Pair[] = []

    // Sort payments by their best available score descending so best matches get priority
    const sorted = [...allPairs].sort((a, b) => {
      const aScore = a.ranked[a.skipCount]?.score ?? -1
      const bScore = b.ranked[b.skipCount]?.score ?? -1
      return bScore - aScore
    })

    for (const p of sorted) {
      // Find first non-used, non-skipped order
      let current: RankedOrder | null = null
      let assignedIdx = p.skipCount
      for (let i = p.skipCount; i < p.ranked.length; i++) {
        if (!usedOrderIds.has(p.ranked[i].order.orderId)) {
          current = p.ranked[i]
          assignedIdx = i
          break
        }
      }
      if (current) usedOrderIds.add(current.order.orderId)
      result.push({ payment: p.payment, id: p.id, ranked: p.ranked, current, skipCount: assignedIdx })
    }

    return result.sort((a, b) => (b.current?.score ?? -1) - (a.current?.score ?? -1))
  }, [unmatchedPayments, orders, dismissedMap])

  const handleDismissPair = (paymentId: string) => {
    setDismissedMap(prev => ({ ...prev, [paymentId]: (prev[paymentId] ?? 0) + 1 }))
  }

  const handleConfirm = async (paymentId: string, orderId: string, storeId: string) => {
    await onManualMatch(paymentId, orderId, storeId)
  }

  return (
    <div className="space-y-4">
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

      {/* All pairs */}
      {pairs.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-2xl py-16"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>No hay pagos pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map(pair => (
            <PairRow
              key={pair.id}
              pair={pair}
              onConfirm={handleConfirm}
              onDismissPair={handleDismissPair}
              onDismissPayment={onDismissPayment}
              onCancelDuplicate={onCancelDuplicate}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PairRow({
  pair,
  onConfirm,
  onDismissPair,
  onDismissPayment,
  onCancelDuplicate,
  loading,
}: {
  pair: Pair
  onConfirm: (paymentId: string, orderId: string, storeId: string) => void
  onDismissPair: (paymentId: string) => void
  onDismissPayment: (paymentId: string) => void
  onCancelDuplicate: (storeId: string, orderId: string) => void
  loading: boolean
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)
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
            <div style={{ marginTop: '12px' }}>
              {!confirmCancel ? (
                <button
                  onClick={() => setConfirmCancel(true)}
                  disabled={loading}
                  style={{
                    fontSize: '11px',
                    padding: '5px 10px',
                    borderRadius: '7px',
                    border: '1px solid rgba(248,113,113,0.18)',
                    background: 'transparent',
                    color: 'rgba(248,113,113,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(248,113,113,0.75)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.4)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(248,113,113,0.45)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.18)' }}
                >
                  orden duplicada
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(248,113,113,0.7)' }}>¿Cancelar en TN?</span>
                  <button
                    onClick={() => { onCancelDuplicate(current.order.storeId, current.order.orderId); setConfirmCancel(false) }}
                    disabled={loading}
                    style={{
                      fontSize: '11px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(248,113,113,0.5)',
                      background: 'rgba(248,113,113,0.1)',
                      color: '#f87171',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    Sí, cancelar
                  </button>
                  <button
                    onClick={() => setConfirmCancel(false)}
                    style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'transparent',
                      color: 'rgba(148,163,184,0.4)',
                      cursor: 'pointer',
                    }}
                  >
                    No
                  </button>
                </div>
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
