'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import type { Toast } from './FinanzasApp'

// Solicitar pagos desde una billetera: mismos 5 tipos y mismos campos que el
// portal de tiendas. La diferencia es que el saldo de billetera está en ARS, así
// que al pagar un retiro en USD o USDT se pide la cotización.

type Tipo = 'ars' | 'usd' | 'usdt' | 'usd_billete' | 'ars_billete'

const TIPO_LABEL: Record<Tipo, string> = {
  ars: 'Transferencia ARS',
  usd: 'Transferencia USD',
  usdt: 'Transferencia USDT',
  usd_billete: 'Recibir USD billete',
  ars_billete: 'Recibir ARS billete',
}
const MONEDA: Record<Tipo, 'ARS' | 'USD' | 'USDT'> = {
  ars: 'ARS', ars_billete: 'ARS', usd: 'USD', usd_billete: 'USD', usdt: 'USDT',
}
const CAMPO_MONTO: Record<Tipo, string> = {
  ars: 'montoArs', usd: 'montoUsd', usdt: 'montoUsdt', usd_billete: 'monto', ars_billete: 'monto',
}

interface Solicitud {
  id: number
  tipo: Tipo
  estado: 'pendiente' | 'pagada'
  datos: Record<string, string | number>
  created_by: string
  created_at: string
  paid_at: string | null
}

function ahoraART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

const fmtMonto = (s: Solicitud) => {
  const n = Number(s.datos[CAMPO_MONTO[s.tipo]] ?? 0)
  return `${n.toLocaleString('es-AR')} ${MONEDA[s.tipo]}${s.tipo.endsWith('billete') ? ' billete' : ''}`
}

export default function BilleteraSolicitudes({
  wallet, notify, onPagada,
}: { wallet: string; notify: (msg: string, type?: Toast['type']) => void; onPagada: () => void }) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [tipo, setTipo] = useState<Tipo>('ars')
  const [d, setD] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(ahoraART())
  const [enviando, setEnviando] = useState(false)
  const [pagando, setPagando] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/finanzas/billetera/solicitudes?wallet=${encodeURIComponent(wallet)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setSolicitudes((await res.json()).solicitudes ?? [])
    } catch (e) {
      notify(`No se pudieron cargar las solicitudes: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }, [wallet, notify])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setD({}) }, [tipo])   // cada tipo tiene sus propios campos

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD(prev => ({ ...prev, [k]: e.target.value }))

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    try {
      const res = await fetch('/api/finanzas/billetera/solicitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet, tipo, datos: d, motivo: motivo.trim() || undefined,
          fecha: new Date(`${fecha}:00-03:00`).toISOString(),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Error')
      notify(`Solicitud #${body.id} creada`, 'success')
      setD({}); setMotivo('')
      cargar()
    } catch (e) {
      notify(`No se pudo crear: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setEnviando(false)
    }
  }

  async function pagar(s: Solicitud) {
    let cotizacion: number | undefined
    if (MONEDA[s.tipo] !== 'ARS') {
      const txt = window.prompt(`Cotización: ARS por 1 ${MONEDA[s.tipo]}`, '')
      if (txt === null) return
      cotizacion = Number(txt.replace(',', '.'))
      if (!Number.isFinite(cotizacion) || cotizacion <= 0) { notify('Cotización inválida', 'error'); return }
    }
    setPagando(s.id)
    try {
      const res = await fetch('/api/finanzas/billetera/pagar-solicitud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, id: s.id, cotizacion }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Error')
      notify(`Solicitud #${s.id} pagada · −${ARS.format(body.salida.ars)}`, 'success')
      cargar()
      onPagada()   // el saldo cambió: recargar el balance
    } catch (e) {
      notify(`No se pudo pagar: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setPagando(null)
    }
  }

  const inputStyle = {
    background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.25)',
    color: 'rgba(226,232,240,0.9)', colorScheme: 'dark' as const,
  }
  const Campo = ({ k, label, tipoInput = 'text', req = false, placeholder = '' }:
    { k: string; label: string; tipoInput?: string; req?: boolean; placeholder?: string }) => (
    <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
      <span>{label}{req && ' *'}</span>
      <input type={tipoInput} step={tipoInput === 'number' ? '0.01' : undefined} min={tipoInput === 'number' ? '0' : undefined}
        required={req} value={d[k] ?? ''} onChange={set(k)} placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
    </label>
  )

  const esBillete = tipo === 'usd_billete' || tipo === 'ars_billete'

  return (
    <div className="space-y-5">
      <motion.form
        onSubmit={crear}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)' }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.8)' }}>
          Nuevo pago desde {wallet}
        </h3>

        <label className="text-xs space-y-1 block max-w-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
          <span>Tipo de transferencia</span>
          <select value={tipo} onChange={e => setTipo(e.target.value as Tipo)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle}>
            {(Object.keys(TIPO_LABEL) as Tipo[]).map(t => (
              <option key={t} value={t} style={{ background: '#0d1117' }}>{TIPO_LABEL[t]}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
          {tipo === 'ars' && <>
            <Campo k="cbu" label="CBU / CVU / Alias" req />
            <Campo k="montoArs" label="Monto ARS" tipoInput="number" req />
            <Campo k="nombreBeneficiario" label="Nombre del beneficiario" />
            <Campo k="cuitBeneficiario" label="CUIT / CUIL / DNI del beneficiario" />
          </>}

          {tipo === 'usd' && <>
            <Campo k="numeroCuenta" label="Número de cuenta" req />
            <Campo k="montoUsd" label="Monto USD" tipoInput="number" req />
            <Campo k="nombreCompleto" label="Nombre completo del beneficiario" req />
            <Campo k="domicilio" label="Domicilio completo" req />
          </>}

          {tipo === 'usdt' && <>
            <Campo k="wallet" label="Wallet cripto del beneficiario" req />
            <Campo k="blockchain" label="Blockchain" req placeholder="TRC20, ERC20…" />
            <Campo k="montoUsdt" label="Monto USDT" tipoInput="number" req />
          </>}

          {esBillete && <>
            <Campo k="monto" label={`Monto ${MONEDA[tipo]}`} tipoInput="number" req />
            <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
              <span>Cómo se recibe *</span>
              <select required value={d.modalidad ?? ''} onChange={set('modalidad')}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle}>
                <option value="" style={{ background: '#0d1117' }}>Elegir…</option>
                <option value="retira" style={{ background: '#0d1117' }}>Paso a retirar</option>
                <option value="envio" style={{ background: '#0d1117' }}>Enviar a una ubicación</option>
              </select>
            </label>
            <Campo k="nombreCompleto" label={d.modalidad === 'envio' ? 'Nombre completo de quien recibe' : 'Nombre completo de quien retira'} req />
            <Campo k="dni" label="DNI" req />
            <Campo k="contacto" label="Número de contacto" req />
            {d.modalidad === 'envio' && <Campo k="direccion" label="Dirección donde entregar" req />}
          </>}

          <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
            <span>Fecha y hora del retiro</span>
            <input type="datetime-local" value={fecha} onChange={e => setFecha(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
          </label>
          <label className="text-xs space-y-1" style={{ color: 'rgba(148,163,184,0.7)' }}>
            <span>Motivo (opcional)</span>
            <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder={TIPO_LABEL[tipo]}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>
            {MONEDA[tipo] === 'ARS'
              ? 'Se descuenta del saldo al marcarla pagada.'
              : `Al marcarla pagada se pide la cotización (ARS por 1 ${MONEDA[tipo]}) para descontar el saldo.`}
          </p>
          <button type="submit" disabled={enviando}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', color: '#00d4ff' }}>
            {enviando ? 'Creando…' : 'Crear solicitud'}
          </button>
        </div>
      </motion.form>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.12)', background: 'linear-gradient(135deg, #0d1117, #111827)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '720px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}>
                {['Fecha', 'Tipo', 'Motivo', 'Monto', 'Estado', ''].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'rgba(148,163,184,0.7)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {solicitudes.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin solicitudes</td></tr>
              ) : solicitudes.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(226,232,240,0.85)' }}>
                    {fmtDate(String(s.datos.fecha ?? s.created_at))}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(148,163,184,0.85)' }}>{TIPO_LABEL[s.tipo]}</td>
                  <td className="px-3 py-2.5" style={{ color: 'rgba(226,232,240,0.85)' }}>{s.datos.motivo || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={{ color: '#f87171' }}>−{fmtMonto(s)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                      style={s.estado === 'pagada'
                        ? { background: 'rgba(0,255,136,0.1)', color: '#00ff88' }
                        : { background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                      {s.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    {s.estado === 'pendiente' && (
                      <button onClick={() => pagar(s)} disabled={pagando === s.id}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
                        style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88' }}>
                        {pagando === s.id ? 'Pagando…' : 'Marcar pagada'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
