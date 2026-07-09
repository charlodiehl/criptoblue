'use client'

import { useState, useEffect, useCallback } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import type { TransferRequest, TransferTipo } from '@/lib/types'
import SolicitudModal from './SolicitudModal'
import ReembolsosAdmin from './ReembolsosAdmin'
import SaldoPersonalizado from './SaldoPersonalizado'
import type { Toast } from './FinanzasApp'

export type SolicitudConTienda = TransferRequest & { storeName: string }
interface Reclamo { timestamp: string; storeId: string; storeName: string; amount: number; orderNumber: string }
interface ComisionesData {
  tiendas: { storeId: string; storeName: string; pct: number }[]
  billeteras: { wallet: string; pct: number }[]
}
const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
}

const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'una transferencia ARS',
  usd: 'una transferencia USD',
  usdt: 'una transferencia USDT',
  usd_billete: 'recibir USD billete',
  ars_billete: 'recibir ARS billete',
}

interface Props {
  notify: (msg: string, type?: Toast['type']) => void
  onSolicitudPagada: () => void
}

export default function AdminGeneralTab({ notify, onSolicitudPagada }: Props) {
  const [solicitudes, setSolicitudes] = useState<SolicitudConTienda[]>([])
  const [reclamos, setReclamos] = useState<Reclamo[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<SolicitudConTienda | null>(null)

  // Configuración de comisiones (solapa desplegable)
  const [configOpen, setConfigOpen] = useState(false)
  const [comisiones, setComisiones] = useState<ComisionesData | null>(null)
  const [selEntity, setSelEntity] = useState('')   // 'tienda:<storeId>' | 'billetera:<wallet>'
  const [pctInput, setPctInput] = useState('')
  const [savingCom, setSavingCom] = useState(false)

  const fetchComisiones = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/comisiones')
      if (res.ok) setComisiones(await res.json())
    } catch { /* silencioso */ }
  }, [])
  // Se cargan al montar (no al abrir la solapa): así el <select> ya tiene todas
  // las opciones antes de que lo abras y nunca se ve parcial ("chico").
  useEffect(() => { fetchComisiones() }, [fetchComisiones])

  function onSelectEntity(v: string) {
    setSelEntity(v)
    if (!v || !comisiones) { setPctInput(''); return }
    const [tipo, id] = v.split(':')
    const pct = tipo === 'tienda'
      ? comisiones.tiendas.find(t => t.storeId === id)?.pct
      : comisiones.billeteras.find(b => b.wallet === id)?.pct
    setPctInput(pct != null ? String(pct) : '')
  }

  async function guardarComision() {
    if (!selEntity || savingCom) return
    const pct = Number(pctInput.replace(',', '.'))
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { notify('Porcentaje inválido (0 a 100)', 'error'); return }
    const [tipo, id] = selEntity.split(':')
    setSavingCom(true)
    try {
      const res = await fetch('/api/finanzas/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, id, pct }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify('Comisión guardada ✓', 'success')
      await fetchComisiones()
      onSolicitudPagada()  // refresca los balances de arriba (ya con la nueva comisión)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setSavingCom(false)
    }
  }

  const fetchAll = useCallback(async () => {
    try {
      const [rs, rr] = await Promise.all([
        fetch('/api/finanzas/solicitudes?estado=pendiente'),
        fetch('/api/finanzas/reclamos'),
      ])
      if (rs.ok) setSolicitudes((await rs.json()).solicitudes || [])
      if (rr.ok) setReclamos((await rr.json()).reclamos || [])
    } catch (e) {
      notify(`No se pudo cargar la central: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  // Carga inicial + refresco cada 60s
  useEffect(() => {
    fetchAll()
    const iv = setInterval(fetchAll, 60_000)
    return () => clearInterval(iv)
  }, [fetchAll])

  function handlePagada() {
    setModal(null)
    fetchAll()
    onSolicitudPagada()  // refresca los balances de la franja superior
  }

  return (
    <div className="space-y-6">
      {/* Configuración de Tiendas y billeteras (solapa desplegable) */}
      <section>
        <button onClick={() => setConfigOpen(v => !v)}
          className="w-full flex items-center justify-between gap-2 rounded-xl px-3 sm:px-4 py-3 text-[13px] sm:text-sm font-semibold transition-all"
          style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', color: '#00d4ff', cursor: 'pointer' }}>
          <span className="flex items-center gap-2 min-w-0 text-left">
            <span className="shrink-0">⚙️</span>
            <span>Configuración de Tiendas y billeteras</span>
          </span>
          <span className="shrink-0" style={{ fontSize: '10px' }}>{configOpen ? '▲' : '▼'}</span>
        </button>
        {configOpen && (
          <div className="mt-3 rounded-xl p-3 sm:p-4 space-y-4"
            style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
            <div>
              <label style={labelStyle}>Tienda o billetera</label>
              <select value={selEntity} onChange={e => onSelectEntity(e.target.value)} disabled={!comisiones}
                style={{ ...inputStyle, colorScheme: 'dark', cursor: comisiones ? 'pointer' : 'wait', opacity: comisiones ? 1 : 0.6 }}>
                {!comisiones ? (
                  <option value="" style={optionStyle}>Cargando…</option>
                ) : (
                  <>
                    <option value="" style={optionStyle}>Seleccioná una entidad…</option>
                    <optgroup label="Tiendas" style={optionStyle}>
                      {comisiones.tiendas.map(t => (
                        <option key={t.storeId} value={`tienda:${t.storeId}`} style={optionStyle}>{t.storeName}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Billeteras" style={optionStyle}>
                      {comisiones.billeteras.map(b => (
                        <option key={b.wallet} value={`billetera:${b.wallet}`} style={optionStyle}>{b.wallet}</option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
            </div>

            {selEntity && (
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1" style={{ minWidth: '120px' }}>
                  <label style={labelStyle}>Comisión (%)</label>
                  <input type="number" inputMode="decimal" min="0" max="100" step="0.1" value={pctInput}
                    onChange={e => setPctInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') guardarComision() }}
                    style={inputStyle} />
                </div>
                <button onClick={guardarComision} disabled={savingCom}
                  className="rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50 w-full sm:w-auto"
                  style={{ padding: '11px 20px', background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: savingCom ? 'not-allowed' : 'pointer' }}>
                  {savingCom ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            )}

            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(148,163,184,0.5)' }}>
              La comisión se descuenta de los ingresos (órdenes de la tienda / pagos de la billetera) y se refleja en el saldo neto de toda la app.
              Valores por defecto: tiendas 3,5% · billeteras 1%.
            </p>
          </div>
        )}
      </section>

      {/* Añadir saldo personalizado (ingreso manual a tienda/billetera) */}
      <SaldoPersonalizado notify={notify} onSaldoAgregado={onSolicitudPagada} />

      {/* Solicitudes pendientes */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.8)' }}>
          Transferencias solicitadas {solicitudes.length > 0 && <span style={{ color: '#fbbf24' }}>· {solicitudes.length} pendiente{solicitudes.length === 1 ? '' : 's'}</span>}
        </h3>
        {loading ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="text-sm py-6 text-center rounded-xl" style={{ color: 'rgba(148,163,184,0.5)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)' }}>
            No hay solicitudes pendientes.
          </p>
        ) : (
          <div className="space-y-2">
            {solicitudes.map(s => (
              <div key={s.id} className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
                style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(226,232,240,0.9)' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
                  <span className="font-bold" style={{ color: '#00d4ff' }}>{s.storeName}</span>
                  <span>solicitó</span>
                  <span className="font-semibold">{TIPO_LABEL[s.tipo]}</span>
                  <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>· {fmtDate(s.createdAt)}</span>
                </div>
                <button onClick={() => setModal(s)}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: 'pointer' }}>
                  Ver detalles
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reembolsos: solicitudes de tiendas + herramienta de gestión */}
      <ReembolsosAdmin notify={notify} onReembolsado={onSolicitudPagada} />

      {/* Reclamos (informativo) */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>
          Pagos adjudicados por tiendas · últimos 7 días
        </h3>
        {reclamos.length === 0 ? (
          <p className="text-sm py-4 text-center rounded-xl" style={{ color: 'rgba(148,163,184,0.45)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)' }}>
            Sin reclamos recientes.
          </p>
        ) : (
          <div className="space-y-1.5">
            {reclamos.map((r, i) => (
              <div key={i} className="rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)', color: 'rgba(226,232,240,0.75)' }}>
                <span className="font-semibold" style={{ color: '#00d4ff' }}>{r.storeName}</span>
                <span>se adjudicó un pago de</span>
                <span className="font-bold" style={{ color: '#00ff88' }}>{ARS.format(r.amount)}</span>
                {r.orderNumber && <span>(orden #{r.orderNumber})</span>}
                <span className="text-[11px] ml-auto" style={{ color: 'rgba(148,163,184,0.45)' }}>{fmtDate(r.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {modal && (
        <SolicitudModal solicitud={modal} notify={notify} onClose={() => setModal(null)} onPaid={handlePagada} />
      )}
    </div>
  )
}
