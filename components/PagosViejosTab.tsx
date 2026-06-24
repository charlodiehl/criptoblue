'use client'

import { useState, useEffect, useMemo } from 'react'
import type { Payment } from '@/lib/types'
import { ARS, fmtDate, matchesSearch } from '@/lib/utils'

const PAGE_SIZE = 100

// Pestaña de SOLO LECTURA: pagos viejos de MercadoPago que quedaron sin emparejar
// (snapshot del borrón). No tiene accionables — es un archivo histórico.
export default function PagosViejosTab() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    fetch('/api/pagos-viejos')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) { setError(d.error); return }
        setPayments(d.payments ?? [])
        setGeneratedAt(d.generatedAt ?? null)
      })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const arr = [...payments].sort((a, b) =>
      new Date(b.fechaPago).getTime() - new Date(a.fechaPago).getTime()
    )
    if (!search.trim()) return arr
    return arr.filter(p => matchesSearch(search, [p.nombrePagador, p.cuitPagador, p.monto, p.emailPagador]))
  }, [payments, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(148,163,184,0.7)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Pagos viejos · MercadoPago (sin emparejar) · {payments.length}
        </h2>
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(148,163,184,0.5)', letterSpacing: '0.05em', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.2)' }}>
          🔒 SOLO LECTURA
        </span>
      </div>
      <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', marginBottom: '14px' }}>
        Archivo histórico de pagos que quedaron sin emparejar al desconectar MercadoPago. No tiene acciones.
      </p>

      {/* Buscador */}
      <div style={{ position: 'relative', marginBottom: '14px' }}>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Buscar por nombre, CUIT o monto..."
          style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '1px solid rgba(148,163,184,0.15)', background: 'rgba(13,17,23,0.6)', color: 'rgba(226,232,240,0.9)', fontSize: '13px', outline: 'none' }}
        />
        {search && (
          <button onClick={() => { setSearch(''); setPage(1) }}
            style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(148,163,184,0.4)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* Paginación superior */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginBottom: '10px' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
            style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: currentPage <= 1 ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.6)', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}>← Anterior</button>
          <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>Pág. {currentPage} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
            style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '7px', border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: currentPage >= totalPages ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.6)', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}>Siguiente →</button>
        </div>
      )}

      {/* Estados */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl py-20 text-center"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}>
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>Cargando...</p>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center rounded-2xl py-20 text-center"
          style={{ background: 'linear-gradient(135deg, #1a0d0d, #1f1111)', border: '1px solid rgba(248,113,113,0.2)' }}>
          <p style={{ fontSize: '13px', color: 'rgba(248,113,113,0.7)' }}>Error: {error}</p>
        </div>
      ) : pageItems.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl py-20 text-center"
          style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}>
          <p style={{ fontSize: '13px', color: 'rgba(148,163,184,0.4)' }}>
            {search.trim() ? 'Sin resultados para esa búsqueda' : 'No hay pagos viejos guardados'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
          {pageItems.map(p => (
            <div key={p.mpPaymentId} style={{
              background: 'linear-gradient(160deg,#0d1117 0%,#0f1824 100%)',
              border: '1px solid rgba(148,163,184,0.12)',
              borderRadius: '14px', padding: '16px 18px',
            }}>
              <p style={{ fontSize: '20px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em', margin: '0 0 6px' }}>
                {ARS.format(p.monto)}
              </p>
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
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.emailPagador}
                </p>
              )}
              <p style={{ fontSize: '10px', color: 'rgba(148,163,184,0.3)', marginTop: '6px' }}>ID: {p.mpPaymentId}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
