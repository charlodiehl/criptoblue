'use client'

import { useState, useEffect, useCallback } from 'react'
import TasaInput from '@/components/TasaInput'
import MontoInput from '@/components/MontoInput'
import type { Toast } from './FinanzasApp'

interface Props {
  notify: (msg: string, type?: Toast['type']) => void
  onSaldoAgregado: () => void   // refresca balances
}

const optionStyle: React.CSSProperties = { background: '#0d1117', color: 'rgba(226,232,240,0.92)' }
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '6px',
}

// Ahora en hora Argentina como "YYYY-MM-DDTHH:mm" (para el input datetime-local)
function nowARTLocal(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export default function SaldoPersonalizado({ notify, onSaldoAgregado }: Props) {
  const [tiendas, setTiendas] = useState<{ storeId: string; storeName: string }[]>([])
  const [billeteras, setBilleteras] = useState<{ wallet: string }[]>([])
  const [loaded, setLoaded] = useState(false)

  const [selEntity, setSelEntity] = useState('')   // 'tienda:<id>' | 'billetera:<wallet>'
  const [fechaHora, setFechaHora] = useState(nowARTLocal())
  const [monto, setMonto] = useState('')
  const [tasa, setTasa] = useState('')
  const [cuit, setCuit] = useState('')
  const [nombre, setNombre] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [formKey, setFormKey] = useState(0)   // remonta el TasaInput al resetear

  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/comisiones')
      if (res.ok) {
        const d = await res.json()
        setTiendas((d.tiendas || []).map((t: { storeId: string; storeName: string }) => ({ storeId: t.storeId, storeName: t.storeName })))
        setBilleteras((d.billeteras || []).map((b: { wallet: string }) => ({ wallet: b.wallet })))
        setLoaded(true)
      }
    } catch { /* silencioso */ }
  }, [])
  useEffect(() => { if (!loaded) fetchEntities() }, [loaded, fetchEntities])

  const esTienda = selEntity.startsWith('tienda:')

  function resetForm() {
    setSelEntity(''); setFechaHora(nowARTLocal()); setMonto(''); setTasa(''); setCuit(''); setNombre(''); setMotivo('')
    setFormKey(k => k + 1)
  }

  async function guardar() {
    if (guardando) return
    if (!selEntity) { notify('Elegí una tienda o billetera', 'error'); return }
    const m = Number(monto.replace(',', '.'))
    if (!Number.isFinite(m) || m <= 0) { notify('Ingresá el monto a agregar (ARS)', 'error'); return }
    if (!fechaHora) { notify('La fecha y hora es obligatoria', 'error'); return }
    const [tipo, id] = selEntity.split(':')
    let tasaNum: number | undefined
    if (tipo === 'tienda') {
      tasaNum = Number(tasa.replace(',', '.'))
      if (!Number.isFinite(tasaNum) || tasaNum <= 0) { notify('La tasa ARS/USDT es obligatoria para tiendas', 'error'); return }
    }
    setGuardando(true)
    try {
      const res = await fetch('/api/finanzas/saldo-personalizado', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, id, fechaHora, monto: m, tasa: tasaNum, cuit, nombre, motivo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      notify('Saldo personalizado agregado ✓', 'success')
      onSaldoAgregado()
      resetForm()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo agregar el saldo', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="rounded-xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.2)' }}>
      <div className="flex items-center gap-2 px-3 sm:px-4 py-3 text-[13px] sm:text-sm font-semibold"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.12)', background: 'rgba(0,212,255,0.04)', color: '#00d4ff' }}>
        <span className="shrink-0">➕</span>
        <span>Añadir Saldo Personalizado</span>
      </div>

      <div className="p-3 sm:p-4 space-y-4">
          <div>
            <label style={labelStyle}>Tienda o billetera</label>
            <select value={selEntity} onChange={e => { setSelEntity(e.target.value); setFormKey(k => k + 1) }} disabled={!loaded}
              style={{ ...inputStyle, colorScheme: 'dark', cursor: loaded ? 'pointer' : 'wait', opacity: loaded ? 1 : 0.6 }}>
              {!loaded ? (
                <option value="" style={optionStyle}>Cargando…</option>
              ) : (
                <>
                  <option value="" style={optionStyle}>Seleccioná una entidad…</option>
                  <optgroup label="Tiendas" style={optionStyle}>
                    {tiendas.map(t => <option key={t.storeId} value={`tienda:${t.storeId}`} style={optionStyle}>{t.storeName}</option>)}
                  </optgroup>
                  <optgroup label="Billeteras" style={optionStyle}>
                    {billeteras.map(b => <option key={b.wallet} value={`billetera:${b.wallet}`} style={optionStyle}>{b.wallet}</option>)}
                  </optgroup>
                </>
              )}
            </select>
          </div>

          {selEntity && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>Fecha y hora del pago *</label>
                  <input type="datetime-local" value={fechaHora} onChange={e => setFechaHora(e.target.value)}
                    style={{ ...inputStyle, colorScheme: 'dark' }} />
                </div>
                <div>
                  <label style={labelStyle}>Monto a agregar (ARS) *</label>
                  <MontoInput value={monto} onChange={setMonto} placeholder="0,00" style={inputStyle} />
                </div>
                {esTienda && (
                  <TasaInput key={formKey} label="Tasa ARS/USDT *" value={tasa} onChange={setTasa} notify={notify} />
                )}
                <div>
                  <label style={labelStyle}>CUIT / CUIL / DNI (opcional)</label>
                  <input value={cuit} onChange={e => setCuit(e.target.value)} placeholder="Opcional" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Nombre del pagador (opcional)</label>
                  <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Opcional" style={inputStyle} />
                </div>
                <div className="sm:col-span-2">
                  <label style={labelStyle}>N° de orden o motivo (opcional)</label>
                  <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Va en la columna N° de orden" style={inputStyle} />
                </div>
              </div>

              <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.55)' }}>
                {esTienda
                  ? 'Se suma al saldo de la tienda en USDT (monto ÷ tasa), con su comisión, y aparece en el registro con la fecha del pago.'
                  : 'Se suma al saldo de la billetera en ARS y aparece en su extracto con la fecha del pago.'}
              </p>

              <button onClick={guardar} disabled={guardando}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: guardando ? 'not-allowed' : 'pointer' }}>
                {guardando ? 'Agregando…' : 'Agregar saldo'}
              </button>
            </div>
          )}
      </div>
    </section>
  )
}
