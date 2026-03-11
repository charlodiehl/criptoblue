'use client'

import type { UnmatchedPayment } from '@/lib/types'

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

interface Props {
  payments: UnmatchedPayment[]
}

export default function PaymentsListTab({ payments }: Props) {
  const sorted = [...payments].sort((a, b) => {
    const ta = a.payment.fechaPago ? new Date(a.payment.fechaPago).getTime() : 0
    const tb = b.payment.fechaPago ? new Date(b.payment.fechaPago).getTime() : 0
    return tb - ta
  })

  if (sorted.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
      >
        <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>No hay pagos pendientes</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)' }}>
          Pagos pendientes
        </span>
        <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>{sorted.length} pago{sorted.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
        {sorted.map(u => {
          const id = u.mpPaymentId || ''
          return (
            <div
              key={id}
              style={{
                background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)',
                border: '1px solid rgba(0,212,255,0.1)',
                borderRadius: '14px',
                padding: '16px 18px',
              }}
            >
              {/* 1. Monto */}
              <p style={{ fontSize: '20px', fontWeight: 800, color: 'white', marginBottom: '6px', letterSpacing: '-0.02em' }}>
                {ARS.format(u.payment.monto)}
              </p>
              {/* 2. CUIT/CUIL/DNI */}
              {u.payment.cuitPagador && (
                <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.65)', fontWeight: 600, marginBottom: '3px' }}>
                  CUIT/DNI: {u.payment.cuitPagador}
                </p>
              )}
              {/* 3. Nombre */}
              {u.payment.nombrePagador ? (
                <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.payment.nombrePagador}
                </p>
              ) : (
                <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '3px' }}>Sin nombre</p>
              )}
              {/* 4. Fecha/hora */}
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>
                {fmtDate(u.payment.fechaPago)}
              </p>
              {/* 5. Email */}
              {u.payment.emailPagador && (
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.payment.emailPagador}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
