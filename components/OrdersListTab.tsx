'use client'

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

const HOURS_48 = 48 * 60 * 60 * 1000

interface Props {
  orders: Order[]
}

export default function OrdersListTab({ orders }: Props) {
  const now = Date.now()
  const recent = orders.filter(o => o.createdAt && (now - new Date(o.createdAt).getTime()) <= HOURS_48)

  if (recent.length === 0) {
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
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,212,255,0.6)' }}>
          Últimas 48hs
        </span>
        <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)' }}>{recent.length} orden{recent.length !== 1 ? 'es' : ''}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
        {recent.map(o => (
          <div
            key={`${o.storeId}-${o.orderId}`}
            style={{
              background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)',
              border: '1px solid rgba(0,212,255,0.1)',
              borderRadius: '14px',
              padding: '16px 18px',
            }}
          >
            {/* 1. Monto */}
            <p style={{ fontSize: '20px', fontWeight: 800, color: 'white', marginBottom: '6px', letterSpacing: '-0.02em' }}>
              {ARS.format(o.total)}
            </p>
            {/* 2. CUIT/CUIL/DNI */}
            {o.customerCuit && (
              <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.65)', fontWeight: 600, marginBottom: '3px' }}>
                CUIT/DNI: {o.customerCuit}
              </p>
            )}
            {/* 3. Nombre */}
            {o.customerName ? (
              <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.customerName}
              </p>
            ) : (
              <p style={{ fontSize: '12px', color: 'rgba(148,163,184,0.3)', fontStyle: 'italic', marginBottom: '3px' }}>Sin nombre</p>
            )}
            {/* 4. Fecha/hora */}
            <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginBottom: '3px' }}>
              {fmtDate(o.createdAt)}
            </p>
            {/* 5. Email */}
            {o.customerEmail && (
              <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
                {o.customerEmail}
              </p>
            )}
            {/* 6. Tienda + # Orden */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingTop: '8px',
                marginTop: '4px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#00d4ff', letterSpacing: '0.05em' }}>
                #{o.orderNumber}
              </span>
              {o.storeName && (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'rgba(148,163,184,0.4)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {o.storeName}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
