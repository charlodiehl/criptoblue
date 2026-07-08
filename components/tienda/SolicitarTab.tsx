'use client'

import { useState, useEffect, useCallback } from 'react'
import { fmtDate } from '@/lib/utils'
import type { TransferRequest, TransferTipo } from '@/lib/types'
import type { Toast } from './TiendaPortal'

interface Props {
  storeId: string
  qs: string
  notify: (msg: string, type?: Toast['type']) => void
}

const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'Transferencia ARS',
  usd: 'Transferencia USD',
  usdt: 'Transferencia USDT',
  usd_billete: 'Recibir USD billete',
  ars_billete: 'Recibir ARS billete',
}

const BLOCKCHAINS = ['TRC-20', 'ERC-20', 'BEP-20', 'Polygon']

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)',
  color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}
// Fondo oscuro para las <option> del select nativo (sino el browser las pinta gris).
const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }

function montoDeSolicitud(s: TransferRequest): string {
  if (s.tipo === 'ars') return `${Number(s.datos.montoArs).toLocaleString('es-AR')} ARS`
  if (s.tipo === 'usd') return `${Number(s.datos.montoUsd).toLocaleString('es-AR')} USD`
  if (s.tipo === 'usdt') return `${Number(s.datos.montoUsdt).toLocaleString('es-AR')} USDT`
  if (s.tipo === 'usd_billete') return `${Number(s.datos.monto).toLocaleString('es-AR')} USD billete`
  return `${Number(s.datos.monto).toLocaleString('es-AR')} ARS billete`
}

export default function SolicitarTab({ qs, notify }: Props) {
  const [tipo, setTipo] = useState<TransferTipo | ''>('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [solicitudes, setSolicitudes] = useState<TransferRequest[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/tienda/transferencias${qs}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      const data = await res.json()
      setSolicitudes(data.solicitudes || [])
    } catch (e) {
      notify(`No se pudieron cargar las solicitudes: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingList(false)
    }
  }, [qs, notify])

  useEffect(() => { fetchList() }, [fetchList])

  function cambiarTipo(t: TransferTipo | '') {
    setTipo(t)
    setForm({})
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tipo || enviando) return

    // Armar datos según tipo (mismos nombres que valida el server)
    let datos: Record<string, string>
    if (tipo === 'ars') {
      datos = { cbu: form.cbu || '', montoArs: form.montoArs || '', nombreBeneficiario: form.nombreBeneficiario || '', cuitBeneficiario: form.cuitBeneficiario || '' }
    } else if (tipo === 'usd') {
      datos = { numeroCuenta: form.numeroCuenta || '', montoUsd: form.montoUsd || '', nombreCompleto: form.nombreCompleto || '', domicilio: form.domicilio || '' }
    } else if (tipo === 'usdt') {
      datos = { wallet: form.wallet || '', blockchain: form.blockchain || '', montoUsdt: form.montoUsdt || '' }
    } else {
      // usd_billete / ars_billete
      datos = { monto: form.monto || '', modalidad: form.modalidad || '', nombreCompleto: form.nombreCompleto || '', dni: form.dni || '', contacto: form.contacto || '' }
      if (form.modalidad === 'envio') datos.direccion = form.direccion || ''
    }

    setEnviando(true)
    try {
      const res = await fetch(`/api/tienda/transferencias${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, datos }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify('Solicitud enviada al administrador ✓', 'success')
      cambiarTipo('')
      fetchList()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo enviar', 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Formulario */}
      <form onSubmit={handleSubmit} className="rounded-2xl p-6 space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
        <div>
          <label style={labelStyle}>Tipo de transferencia</label>
          <select value={tipo} onChange={e => cambiarTipo(e.target.value as TransferTipo | '')}
            style={{ ...inputStyle, colorScheme: 'dark', cursor: 'pointer' }}>
            <option value="" style={optionStyle}>Seleccioná un tipo…</option>
            <option value="ars" style={optionStyle}>Transferencia ARS</option>
            <option value="usd" style={optionStyle}>Transferencia USD</option>
            <option value="usdt" style={optionStyle}>Transferencia USDT</option>
            <option value="usd_billete" style={optionStyle}>Recibir USD billete</option>
            <option value="ars_billete" style={optionStyle}>Recibir ARS billete</option>
          </select>
        </div>

        {tipo === 'ars' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label style={labelStyle}>CBU / CVU / Alias *</label>
              <input style={inputStyle} value={form.cbu || ''} onChange={e => set('cbu', e.target.value)} placeholder="Ej: micuenta.mp o 0000..." /></div>
            <div><label style={labelStyle}>Monto ARS *</label>
              <input type="number" min="0" step="0.01" style={inputStyle} value={form.montoArs || ''} onChange={e => set('montoArs', e.target.value)} placeholder="0.00" /></div>
            <div><label style={labelStyle}>Nombre del beneficiario</label>
              <input style={inputStyle} value={form.nombreBeneficiario || ''} onChange={e => set('nombreBeneficiario', e.target.value)} placeholder="Opcional" /></div>
            <div className="sm:col-span-2"><label style={labelStyle}>CUIT / CUIL / DNI del beneficiario</label>
              <input style={inputStyle} value={form.cuitBeneficiario || ''} onChange={e => set('cuitBeneficiario', e.target.value)} placeholder="Opcional" /></div>
          </div>
        )}

        {tipo === 'usd' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label style={labelStyle}>Número de cuenta *</label>
              <input style={inputStyle} value={form.numeroCuenta || ''} onChange={e => set('numeroCuenta', e.target.value)} /></div>
            <div><label style={labelStyle}>Monto USD *</label>
              <input type="number" min="0" step="0.01" style={inputStyle} value={form.montoUsd || ''} onChange={e => set('montoUsd', e.target.value)} placeholder="0.00" /></div>
            <div><label style={labelStyle}>Nombre completo del beneficiario *</label>
              <input style={inputStyle} value={form.nombreCompleto || ''} onChange={e => set('nombreCompleto', e.target.value)} /></div>
            <div><label style={labelStyle}>Domicilio completo *</label>
              <input style={inputStyle} value={form.domicilio || ''} onChange={e => set('domicilio', e.target.value)} /></div>
          </div>
        )}

        {tipo === 'usdt' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label style={labelStyle}>Wallet cripto del beneficiario *</label>
              <input style={inputStyle} value={form.wallet || ''} onChange={e => set('wallet', e.target.value)} placeholder="Dirección de la wallet" /></div>
            <div><label style={labelStyle}>Blockchain *</label>
              <input style={inputStyle} list="blockchains" value={form.blockchain || ''} onChange={e => set('blockchain', e.target.value)} placeholder="TRC-20, ERC-20…" />
              <datalist id="blockchains">{BLOCKCHAINS.map(b => <option key={b} value={b} />)}</datalist></div>
            <div><label style={labelStyle}>Monto USDT *</label>
              <input type="number" min="0" step="0.01" style={inputStyle} value={form.montoUsdt || ''} onChange={e => set('montoUsdt', e.target.value)} placeholder="0.00" /></div>
          </div>
        )}

        {(tipo === 'usd_billete' || tipo === 'ars_billete') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 text-xs px-3 py-2.5 rounded-lg leading-relaxed"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}>
              ⚠️ La entrega de efectivo está <strong>sujeta a disponibilidad</strong> y se realiza únicamente en <strong>CABA y zonas seleccionadas de los alrededores</strong>. Una vez recibida la solicitud, te contactaremos por el medio indicado para coordinar los detalles de la entrega.
            </div>
            <div><label style={labelStyle}>Monto {tipo === 'usd_billete' ? 'USD' : 'ARS'} *</label>
              <input type="number" min="0" step="0.01" style={inputStyle} value={form.monto || ''} onChange={e => set('monto', e.target.value)} placeholder="0.00" /></div>
            <div><label style={labelStyle}>¿Cómo querés recibir? *</label>
              <select style={{ ...inputStyle, colorScheme: 'dark', cursor: 'pointer' }} value={form.modalidad || ''} onChange={e => set('modalidad', e.target.value)}>
                <option value="" style={optionStyle}>Elegí una opción…</option>
                <option value="retira" style={optionStyle}>Paso a retirar</option>
                <option value="envio" style={optionStyle}>Enviar a una ubicación</option>
              </select></div>

            {form.modalidad === 'retira' && (<>
              <div><label style={labelStyle}>Nombre completo de quien retira *</label>
                <input style={inputStyle} value={form.nombreCompleto || ''} onChange={e => set('nombreCompleto', e.target.value)} /></div>
              <div><label style={labelStyle}>DNI *</label>
                <input style={inputStyle} value={form.dni || ''} onChange={e => set('dni', e.target.value)} /></div>
              <div className="sm:col-span-2"><label style={labelStyle}>Número de contacto (para coordinar ubicación y horario) *</label>
                <input style={inputStyle} value={form.contacto || ''} onChange={e => set('contacto', e.target.value)} placeholder="Tel / WhatsApp" /></div>
            </>)}

            {form.modalidad === 'envio' && (<>
              <div><label style={labelStyle}>Nombre completo de quien recibe *</label>
                <input style={inputStyle} value={form.nombreCompleto || ''} onChange={e => set('nombreCompleto', e.target.value)} /></div>
              <div><label style={labelStyle}>DNI *</label>
                <input style={inputStyle} value={form.dni || ''} onChange={e => set('dni', e.target.value)} /></div>
              <div className="sm:col-span-2"><label style={labelStyle}>Dirección donde entregar *</label>
                <input style={inputStyle} value={form.direccion || ''} onChange={e => set('direccion', e.target.value)} /></div>
              <div className="sm:col-span-2"><label style={labelStyle}>Número de contacto *</label>
                <input style={inputStyle} value={form.contacto || ''} onChange={e => set('contacto', e.target.value)} placeholder="Tel / WhatsApp" /></div>
            </>)}
          </div>
        )}

        {tipo && (
          <button type="submit" disabled={enviando}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', boxShadow: '0 0 20px rgba(0,212,255,0.25)', cursor: enviando ? 'not-allowed' : 'pointer' }}>
            {enviando ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        )}
      </form>

      {/* Listado de solicitudes propias */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.7)' }}>Mis solicitudes</h3>
        {loadingList ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Todavía no enviaste solicitudes.</p>
        ) : (
          <div className="space-y-2">
            {solicitudes.map(s => (
              <div key={s.id} className="rounded-xl p-4"
                style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>{TIPO_LABEL[s.tipo]}</span>
                    <span className="text-sm font-bold" style={{ color: '#00d4ff' }}>{montoDeSolicitud(s)}</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                    style={s.estado === 'pagada'
                      ? { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' }
                      : { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' }}>
                    {s.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                  </span>
                </div>
                <div className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  Solicitada: {fmtDate(s.createdAt)}{s.paidAt ? ` · Pagada: ${fmtDate(s.paidAt)}` : ''}
                </div>
                {s.estado === 'pagada' && s.descuento && (
                  <div className="text-[11px] mt-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.25)', color: 'rgba(226,232,240,0.7)' }}>
                    Descontado del saldo: <span style={{ color: '#f87171' }}>−{Number(s.descuento.arsDescontado).toLocaleString('es-AR')} ARS</span>
                    {' · '}<span style={{ color: '#f87171' }}>−{Number(s.descuento.usdtDescontado).toLocaleString('es-AR', { maximumFractionDigits: 2 })} USDT</span>
                    {s.comprobantePath && (
                      <> · <a href={`/api/tienda/comprobante?id=${s.id}${qs ? `&${qs.slice(1)}` : ''}`} target="_blank" rel="noopener noreferrer" style={{ color: '#00d4ff', textDecoration: 'underline' }}>Ver comprobante</a></>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
