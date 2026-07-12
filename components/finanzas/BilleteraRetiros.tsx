'use client'

import { useState, useEffect, useCallback } from 'react'
import { ARS, fmtDate } from '@/lib/utils'
import MontoInput from '@/components/MontoInput'
import type { TransferTipo } from '@/lib/types'
import type { Toast } from './FinanzasApp'

// "Retirar saldo" de una billetera. Copia del formulario del portal de tiendas
// (components/tienda/SolicitarTab.tsx): mismos tipos, mismos campos, mismo aspecto.
//
// Diferencia de fondo: una billetera gestiona sus propios retiros. No genera una
// solicitud que el admin aprueba (eso es el flujo de las tiendas): el retiro se
// asienta en el acto y descuenta el saldo. Por eso el formulario pide dos cosas más:
//   • la fecha/hora real del retiro (sirve para asentar retiros pasados);
//   • la cotización, cuando el retiro es en USD o USDT, porque el saldo está en ARS
//     y no hay un paso de pago posterior donde pedirla.

const TIPO_LABEL: Record<TransferTipo, string> = {
  ars: 'Transferencia ARS',
  usd: 'Transferencia USD',
  usdt: 'Transferencia USDT',
  usd_billete: 'Recibir USD billete',
  ars_billete: 'Recibir ARS billete',
}

const MONEDA: Record<TransferTipo, 'ARS' | 'USD' | 'USDT'> = {
  ars: 'ARS', ars_billete: 'ARS', usd: 'USD', usd_billete: 'USD', usdt: 'USDT',
}
const CAMPO_MONTO: Record<TransferTipo, string> = {
  ars: 'montoArs', usd: 'montoUsd', usdt: 'montoUsdt', usd_billete: 'monto', ars_billete: 'monto',
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

interface Retiro {
  id: number
  tipo: TransferTipo | 'ajuste'
  fecha: string
  ars: number
  moneda: 'ARS' | 'USD' | 'USDT'
  montoOrigen: number
  cotizacion: number | null
  motivo: string
  createdBy: string
}

// Ahora en horario Argentina, para el input datetime-local
function ahoraART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export default function BilleteraRetiros({
  wallet, notify, onRetiro,
}: { wallet: string; notify: (msg: string, type?: Toast['type']) => void; onRetiro: () => void }) {
  const [tipo, setTipo] = useState<TransferTipo | ''>('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [fecha, setFecha] = useState(ahoraART())
  const [motivo, setMotivo] = useState('')
  const [cotizacion, setCotizacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [retiros, setRetiros] = useState<Retiro[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/finanzas/billetera/retiros?wallet=${encodeURIComponent(wallet)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      const data = await res.json()
      setRetiros(data.retiros || [])
    } catch (e) {
      notify(`No se pudieron cargar los retiros: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingList(false)
    }
  }, [wallet, notify])

  useEffect(() => { fetchList() }, [fetchList])

  function cambiarTipo(t: TransferTipo | '') {
    setTipo(t)
    setForm({})
    setCotizacion('')
  }

  // Cuánto va a salir de la billetera, con la misma cuenta que hace el server.
  const necesitaCotizacion = !!tipo && MONEDA[tipo] !== 'ARS'
  const montoOrigen = tipo ? Number(form[CAMPO_MONTO[tipo]] || 0) : 0
  const arsPrevisto = necesitaCotizacion ? montoOrigen * Number(cotizacion || 0) : montoOrigen

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tipo || enviando) return
    if (necesitaCotizacion && !(Number(cotizacion) > 0)) {
      notify(`Falta la cotización: ARS por 1 ${MONEDA[tipo]}`, 'error')
      return
    }

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
      const res = await fetch('/api/finanzas/billetera/retiros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet, tipo, datos,
          motivo: motivo.trim() || undefined,
          fecha: new Date(`${fecha}:00-03:00`).toISOString(),
          ...(necesitaCotizacion ? { cotizacion: Number(cotizacion) } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify(`Retiro asentado · −${ARS.format(data.salida.ars)}`, 'success')
      cambiarTipo('')
      setMotivo('')
      fetchList()
      onRetiro()   // el saldo cambió: recargar el balance
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo asentar el retiro', 'error')
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
              <MontoInput style={inputStyle} value={form.montoArs || ''} onChange={v => set('montoArs', v)} placeholder="0,00" /></div>
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
              <MontoInput style={inputStyle} value={form.montoUsd || ''} onChange={v => set('montoUsd', v)} placeholder="0,00" /></div>
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
              <input style={inputStyle} list="blockchains-billetera" value={form.blockchain || ''} onChange={e => set('blockchain', e.target.value)} placeholder="TRC-20, ERC-20…" />
              <datalist id="blockchains-billetera">{BLOCKCHAINS.map(b => <option key={b} value={b} />)}</datalist></div>
            <div><label style={labelStyle}>Monto USDT *</label>
              <MontoInput style={inputStyle} value={form.montoUsdt || ''} onChange={v => set('montoUsdt', v)} placeholder="0,00" /></div>
          </div>
        )}

        {(tipo === 'usd_billete' || tipo === 'ars_billete') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label style={labelStyle}>Monto {tipo === 'usd_billete' ? 'USD' : 'ARS'} *</label>
              <MontoInput style={inputStyle} value={form.monto || ''} onChange={v => set('monto', v)} placeholder="0,00" /></div>
            <div><label style={labelStyle}>¿Cómo se entrega? *</label>
              <select style={{ ...inputStyle, colorScheme: 'dark', cursor: 'pointer' }} value={form.modalidad || ''} onChange={e => set('modalidad', e.target.value)}>
                <option value="" style={optionStyle}>Elegí una opción…</option>
                <option value="retira" style={optionStyle}>Pasa a retirar</option>
                <option value="envio" style={optionStyle}>Enviar a una ubicación</option>
              </select></div>

            {form.modalidad === 'retira' && (<>
              <div><label style={labelStyle}>Nombre completo de quien retira *</label>
                <input style={inputStyle} value={form.nombreCompleto || ''} onChange={e => set('nombreCompleto', e.target.value)} /></div>
              <div><label style={labelStyle}>DNI *</label>
                <input style={inputStyle} value={form.dni || ''} onChange={e => set('dni', e.target.value)} /></div>
              <div className="sm:col-span-2"><label style={labelStyle}>Número de contacto *</label>
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

        {/* Propio de la billetera: el retiro se asienta ya, así que la fecha y la
            cotización (si no es ARS) se cargan acá y no en un paso posterior. */}
        {tipo && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label style={labelStyle}>Fecha y hora del retiro *</label>
              <input type="datetime-local" style={{ ...inputStyle, colorScheme: 'dark' }} value={fecha} onChange={e => setFecha(e.target.value)} /></div>
            <div><label style={labelStyle}>Motivo</label>
              <input style={inputStyle} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder={TIPO_LABEL[tipo]} /></div>
            {necesitaCotizacion && (
              <div><label style={labelStyle}>Cotización — ARS por 1 {MONEDA[tipo]} *</label>
                <MontoInput style={inputStyle} value={cotizacion} onChange={setCotizacion} placeholder="0,00" /></div>
            )}
          </div>
        )}

        {tipo && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <p className="text-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
              Sale de la billetera: <span className="font-bold" style={{ color: '#f87171' }}>−{ARS.format(arsPrevisto || 0)}</span>
            </p>
            <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Se descuenta del saldo al confirmar.</span>
          </div>
        )}

        {tipo && (
          <button type="submit" disabled={enviando || !(arsPrevisto > 0)}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', boxShadow: '0 0 20px rgba(0,212,255,0.25)', cursor: enviando ? 'not-allowed' : 'pointer' }}>
            {enviando ? 'Registrando…' : 'Registrar retiro'}
          </button>
        )}
      </form>

      {/* Retiros ya asentados */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.7)' }}>Retiros de {wallet}</h3>
        {loadingList ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
        ) : retiros.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Todavía no hay retiros.</p>
        ) : (
          <div className="space-y-2">
            {retiros.map(r => (
              <div key={r.id} className="rounded-xl p-4"
                style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(148,163,184,0.1)' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>{r.motivo}</span>
                    {r.cotizacion != null && (
                      <span className="text-sm font-bold" style={{ color: '#00d4ff' }}>
                        {r.montoOrigen.toLocaleString('es-AR')} {r.moneda} × {ARS.format(r.cotizacion)}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-bold" style={{ color: '#f87171' }}>−{ARS.format(r.ars)}</span>
                </div>
                <div className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  {fmtDate(r.fecha)}{r.createdBy ? ` · ${r.createdBy}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
