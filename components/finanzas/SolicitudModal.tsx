'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import TasaInput from '@/components/TasaInput'
import type { DescuentoMoneda } from '@/lib/types'
import type { SolicitudConTienda } from './AdminGeneralTab'
import type { Toast } from './FinanzasApp'

interface Props {
  solicitud: SolicitudConTienda
  notify: (msg: string, type?: Toast['type']) => void
  onClose: () => void
  onPaid: () => void
}

const MONEDA_LABEL: Record<DescuentoMoneda, string> = {
  USDT: 'USDT', USD: 'USD', ARS: 'ARS', USD_BILLETE: 'USD billete', ARS_BILLETE: 'ARS billete',
}

// La moneda del descuento NO se elige: la fija el tipo de solicitud que hizo la
// tienda. Una transferencia ARS se descuenta en ARS, una USDT en USDT, etc.
// (el tipo llega en minúscula: 'ars', 'usd_billete'…).
const TIPO_A_MONEDA: Record<string, DescuentoMoneda> = {
  ars: 'ARS', usd: 'USD', usdt: 'USDT', usd_billete: 'USD_BILLETE', ars_billete: 'ARS_BILLETE',
}

// Campos de tasa obligatorios por moneda (espejo de calcularDescuento en el server).
// El saldo vive solo en USDT → solo se piden las tasas para pasar A USDT.
const TASAS_POR_MONEDA: Record<DescuentoMoneda, { key: string; label: string }[]> = {
  ARS: [{ key: 'cotizacionUsdtArs', label: 'Cotización USDT/ARS (cuántos ARS = 1 USDT)' }],
  ARS_BILLETE: [{ key: 'cotizacionUsdtArs', label: 'Cotización USDT/ARS (cuántos ARS = 1 USDT)' }],
  USDT: [],
  USD: [{ key: 'tasaUsdUsdt', label: 'Tasa USD/USDT (cuántos USDT = 1 USD)' }],
  USD_BILLETE: [{ key: 'tasaUsdUsdt', label: 'Tasa USD/USDT (cuántos USDT = 1 USD)' }],
}

// Etiquetas legibles de los campos del formulario que envió la tienda
const CAMPO_LABEL: Record<string, string> = {
  cbu: 'CBU / CVU / Alias', montoArs: 'Monto ARS', nombreBeneficiario: 'Nombre del beneficiario', cuitBeneficiario: 'CUIT/CUIL/DNI',
  numeroCuenta: 'Número de cuenta', montoUsd: 'Monto USD', nombreCompleto: 'Nombre completo', domicilio: 'Domicilio',
  wallet: 'Wallet cripto', blockchain: 'Blockchain', montoUsdt: 'Monto USDT',
  monto: 'Monto', modalidad: 'Modalidad', dni: 'DNI', contacto: 'Contacto', direccion: 'Dirección',
}

// Valor legible para el detalle (la modalidad se guarda como 'retira'/'envio').
function valorLegible(k: string, v: unknown): string {
  if (k === 'modalidad') return v === 'retira' ? 'Paso a retirar' : v === 'envio' ? 'Enviar a una ubicación' : String(v)
  return String(v)
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}

// Cálculo de descuento en vivo (solo preview; el server recalcula y es la fuente de
// verdad). El saldo es USDT-only → solo se calcula el USDT a descontar.
function preview(moneda: DescuentoMoneda, monto: number, tasas: Record<string, number>): { usdt: number } | null {
  if (!Number.isFinite(monto) || monto <= 0) return null
  const ok = (v: number | undefined) => Number.isFinite(v) && (v as number) > 0
  switch (moneda) {
    case 'ARS': case 'ARS_BILLETE':
      return ok(tasas.cotizacionUsdtArs) ? { usdt: monto / tasas.cotizacionUsdtArs } : null
    case 'USDT':
      return { usdt: monto }
    case 'USD': case 'USD_BILLETE':
      return ok(tasas.tasaUsdUsdt) ? { usdt: monto * tasas.tasaUsdUsdt } : null
  }
}

export default function SolicitudModal({ solicitud, notify, onClose, onPaid }: Props) {
  // La moneda del descuento queda fijada por el tipo de la solicitud, no se pregunta.
  const moneda: DescuentoMoneda | '' = TIPO_A_MONEDA[solicitud.tipo] ?? ''
  const [monto, setMonto] = useState('')
  const [tasas, setTasas] = useState<Record<string, string>>({})
  const [comprobantePath, setComprobantePath] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [pagando, setPagando] = useState(false)

  const setTasa = (k: string, v: string) => setTasas(t => ({ ...t, [k]: v }))

  const tasasNum = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(tasas)) out[k] = Number(v)
    return out
  }, [tasas])

  const calc = moneda ? preview(moneda, Number(monto), tasasNum) : null

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append('id', String(solicitud.id))
      fd.append('file', file)
      const res = await fetch('/api/finanzas/comprobante', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setComprobantePath(data.path)
      notify('Comprobante adjuntado ✓', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo subir', 'error')
    } finally {
      setSubiendo(false)
    }
  }

  async function handlePagar() {
    if (pagando) return
    if (!moneda) { notify('No se pudo determinar la moneda de la solicitud', 'error'); return }
    if (!calc) { notify('Completá monto y tasas obligatorias', 'error'); return }
    setPagando(true)
    try {
      const tasasPayload: Record<string, number> = {}
      for (const { key } of TASAS_POR_MONEDA[moneda]) tasasPayload[key] = Number(tasas[key])
      const res = await fetch('/api/finanzas/pagar-solicitud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: solicitud.id, moneda, monto: Number(monto), tasas: tasasPayload, comprobantePath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(`Pago confirmado. Se descontó ${data.descuento.usdtDescontado.toFixed(2)} USDT del saldo ✓`, 'success')
      onPaid()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo confirmar', 'error')
    } finally {
      setPagando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: 'linear-gradient(135deg, #0f1923, #0d1117)', border: '1px solid rgba(0,212,255,0.2)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,212,255,0.1)' }}>
          <div>
            <div className="text-sm font-bold" style={{ color: '#00d4ff' }}>{solicitud.storeName}</div>
            <div className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>Transferencia {solicitud.tipo.toUpperCase()} · solicitud #{solicitud.id}</div>
          </div>
          <button onClick={onClose} className="text-xl px-2" style={{ color: 'rgba(148,163,184,0.6)', cursor: 'pointer' }}>×</button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Datos que mandó la tienda */}
          <div>
            <h4 className="text-[11px] uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.55)' }}>Datos de la solicitud</h4>
            <div className="rounded-xl p-4 space-y-1.5" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(148,163,184,0.08)' }}>
              {Object.entries(solicitud.datos).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <span style={{ color: 'rgba(148,163,184,0.6)' }}>{CAMPO_LABEL[k] || k}</span>
                  <span className="text-right font-medium break-all" style={{ color: 'rgba(226,232,240,0.9)' }}>{valorLegible(k, v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Comprobante (opcional) */}
          <div>
            <h4 className="text-[11px] uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.55)' }}>Comprobante (opcional)</h4>
            <label className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-all"
              style={{ background: comprobantePath ? 'rgba(0,255,136,0.08)' : 'rgba(0,212,255,0.06)', border: `1px solid ${comprobantePath ? 'rgba(0,255,136,0.3)' : 'rgba(0,212,255,0.2)'}`, color: comprobantePath ? '#00ff88' : 'rgba(0,212,255,0.85)' }}>
              <input type="file" className="hidden" onChange={handleUpload} disabled={subiendo} accept="image/*,application/pdf" />
              {subiendo ? 'Subiendo…' : comprobantePath ? '✓ Comprobante adjuntado (cambiar)' : '📎 Adjuntar comprobante'}
            </label>
          </div>

          {/* Descuento */}
          <div>
            <h4 className="text-[11px] uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.55)' }}>Descontar saldo a la tienda</h4>
            <div className="space-y-3">
              <div>
                <label style={labelStyle}>Moneda retirada</label>
                {/* No se elige: la define el tipo de la solicitud. */}
                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'default' }}>
                  <span style={{ fontWeight: 600 }}>{moneda ? MONEDA_LABEL[moneda] : '—'}</span>
                  <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>según la solicitud</span>
                </div>
              </div>

              {moneda && (
                <>
                  <div>
                    <label style={labelStyle}>Monto retirado ({MONEDA_LABEL[moneda]})</label>
                    <input type="number" min="0" step="0.01" style={inputStyle} value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" />
                  </div>
                  {TASAS_POR_MONEDA[moneda].map(t => (
                    // La cotización ARS/USDT admite "Usar cotización estándar"; la USD/USDT no.
                    t.key === 'cotizacionUsdtArs'
                      ? <TasaInput key={t.key} label={`${t.label} *`} value={tasas[t.key] || ''} onChange={v => setTasa(t.key, v)} notify={notify} />
                      : (
                        <div key={t.key}>
                          <label style={labelStyle}>{t.label} *</label>
                          <input type="number" min="0" step="0.0001" style={inputStyle} value={tasas[t.key] || ''} onChange={e => setTasa(t.key, e.target.value)} placeholder="0.00" />
                        </div>
                      )
                  ))}
                </>
              )}

              {/* Preview del cálculo */}
              {moneda && (
                <div className="rounded-xl px-4 py-3 text-sm"
                  style={{ background: calc ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${calc ? 'rgba(248,113,113,0.2)' : 'rgba(148,163,184,0.1)'}` }}>
                  {calc ? (
                    <span style={{ color: 'rgba(226,232,240,0.85)' }}>
                      Se descontarán <span className="font-bold" style={{ color: '#f87171' }}>{calc.usdt.toLocaleString('es-AR', { maximumFractionDigits: 2 })} USDT</span> del saldo.
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(148,163,184,0.5)' }}>Completá el monto{TASAS_POR_MONEDA[moneda].length ? ' y la tasa' : ''} para ver el descuento.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid rgba(0,212,255,0.1)' }}>
          <button onClick={handlePagar} disabled={!calc || pagando}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: calc && !pagando ? 'linear-gradient(135deg, #00d4ff, #0070f3)' : 'rgba(0,212,255,0.1)', cursor: calc && !pagando ? 'pointer' : 'not-allowed' }}>
            {pagando ? 'Confirmando…' : 'Confirmar pago y descontar'}
          </button>
          <button onClick={onClose} disabled={pagando}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)', cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  )
}
