'use client'

import { useState } from 'react'
import type { LogEntry } from '@/lib/types'

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

function fmtMontoDisplay(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

// Para el TSV: miles con punto, sin decimales, sin símbolo
function fmtMontoTSV(n: number) {
  return Math.round(n).toLocaleString('es-AR', { useGrouping: true })
}

function fmtCuit(s: string) {
  return (s || '').replace(/\D/g, '')
}

function billetera(_entry: LogEntry): string {
  return 'MercadoPago'
}

function nombrePagador(entry: LogEntry): string {
  return entry.payment?.nombrePagador || entry.order?.customerName || entry.customerName || ''
}

interface Props {
  entries: LogEntry[]
}

const HEADERS = ['Fecha y hora', 'Monto', 'CUIT/CUIL/DNI', 'Nombre y apellido', 'Tienda', 'Número de orden', 'Billetera']

export default function RegistroTab({ entries }: Props) {
  const [copied, setCopied] = useState(false)

  const paid = entries
    .filter(e => e.action === 'manual_paid' || e.action === 'auto_paid')
    .sort((a, b) => {
      const da = a.payment?.fechaPago || a.timestamp
      const db = b.payment?.fechaPago || b.timestamp
      return new Date(db).getTime() - new Date(da).getTime()
    })

  const handleCopy = () => {
    const rows = paid.map(e => [
      fmtDate(e.payment?.fechaPago || e.timestamp),
      fmtMontoTSV(e.payment?.monto ?? e.amount ?? 0),
      fmtCuit(e.payment?.cuitPagador || ''),
      nombrePagador(e),
      e.storeName || e.order?.storeName || '',
      e.orderNumber || e.order?.orderNumber || '',
      billetera(e),
    ])

    const tsv = [HEADERS, ...rows].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
          {paid.length} emparejamiento{paid.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleCopy}
          disabled={paid.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            fontSize: '13px',
            fontWeight: 600,
            padding: '9px 18px',
            borderRadius: '10px',
            border: copied ? '1px solid rgba(0,255,136,0.4)' : '1px solid rgba(0,212,255,0.25)',
            background: copied ? 'rgba(0,255,136,0.08)' : 'rgba(0,212,255,0.06)',
            color: copied ? '#00ff88' : '#00d4ff',
            cursor: paid.length === 0 ? 'not-allowed' : 'pointer',
            opacity: paid.length === 0 ? 0.4 : 1,
            transition: 'all 0.2s',
          }}
        >
          {copied ? '✓ Copiado' : '⧉ Copiar para Google Sheets'}
        </button>
      </div>

      {paid.length === 0 ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '16px', padding: '64px 0',
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.08)',
          }}
        >
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.35)' }}>No hay emparejamientos registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {HEADERS.map(h => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: 'rgba(0,212,255,0.5)',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paid.map((e, i) => {
                const fecha = fmtDate(e.payment?.fechaPago || e.timestamp)
                const monto = fmtMontoDisplay(e.payment?.monto ?? e.amount ?? 0)
                const cuit = fmtCuit(e.payment?.cuitPagador || '')
                const nombre = nombrePagador(e)
                const tienda = e.storeName || e.order?.storeName || '—'
                const orden = e.orderNumber || e.order?.orderNumber || '—'
                const bill = billetera(e)

                return (
                  <tr
                    key={`${e.mpPaymentId}-${i}`}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(0,212,255,0.015)',
                    }}
                  >
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.6)', whiteSpace: 'nowrap' }}>{fecha}</td>
                    <td style={{ padding: '12px 14px', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>{monto}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(0,212,255,0.7)', fontFamily: 'monospace' }}>{cuit || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(226,232,240,0.85)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.5)', whiteSpace: 'nowrap' }}>{tienda}</td>
                    <td style={{ padding: '12px 14px', color: '#00d4ff', fontWeight: 600, whiteSpace: 'nowrap' }}>{orden}</td>
                    <td style={{ padding: '12px 14px', color: 'rgba(148,163,184,0.4)', whiteSpace: 'nowrap' }}>{bill}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
