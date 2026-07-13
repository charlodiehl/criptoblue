'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ARS } from '@/lib/utils'
import MontoInput from '@/components/MontoInput'

// Edición de una entrada del registro (solo admin). Los cambios se guardan en
// registro_log, que es la fuente de verdad: se ven acá y en el registro general.
//
// El número de orden se valida contra la tienda real mientras se escribe. Nada de
// eso bloquea —la orden puede no existir, estar pendiente o cancelada, y el admin
// igual querer guardarla— salvo una cosa: que ese número ya esté EXACTAMENTE igual
// en otra entrada del registro de esa tienda.

export interface FilaEditable {
  registroId: number
  monto: number
  cuit: string
  nombre: string
  orderNumber: string
  usdtRate: number | null
}

interface Validacion {
  ordenConsultada: string   // el número base, sin el sufijo "(n)"
  esPagoParcial: boolean
  existe: boolean
  errorTienda: string | null
  paymentStatus: string | null
  orderStatus: string | null
  cliente: string | null
  total: number | null
  duplicadoExacto: { registroId: number; orderNumber: string; fecha: string; cliente: string } | null
  similares: { registroId: number; orderNumber: string; fecha: string; monto: number; cliente: string }[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '13px', padding: '9px 12px', borderRadius: '9px',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)',
  color: 'rgba(226,232,240,0.92)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: 'rgba(0,212,255,0.7)', marginBottom: '5px',
}

const fmtUsdt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Estados de pago que cuentan como "cobrada" en cada plataforma.
const PAGADA = ['paid', 'authorized']

export default function EditarRegistroModal({
  fila, storeId, onCerrar, onGuardado, notify,
}: {
  fila: FilaEditable
  storeId: string
  onCerrar: () => void
  onGuardado: () => void
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [orderNumber, setOrderNumber] = useState(fila.orderNumber)
  const [nombre, setNombre] = useState(fila.nombre)
  const [cuit, setCuit] = useState(fila.cuit)
  const [cotizacion, setCotizacion] = useState(fila.usdtRate != null ? String(fila.usdtRate) : '')
  const [validacion, setValidacion] = useState<Validacion | null>(null)
  const [validando, setValidando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validar = useCallback(async (num: string) => {
    if (!num.trim() || num.trim() === fila.orderNumber) { setValidacion(null); return }
    setValidando(true)
    try {
      const p = new URLSearchParams({ storeId, orderNumber: num.trim(), registroId: String(fila.registroId) })
      const res = await fetch(`/api/finanzas/registro/validar-orden?${p}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setValidacion(await res.json())
    } catch (e) {
      notify(`No se pudo validar la orden: ${e instanceof Error ? e.message : e}`, 'error')
      setValidacion(null)
    } finally {
      setValidando(false)
    }
  }, [storeId, fila.registroId, fila.orderNumber, notify])

  // Valida mientras se escribe, con un respiro para no pegarle a la tienda en cada tecla.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => validar(orderNumber), 600)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [orderNumber, validar])

  // La edición NUNCA bloquea: a veces se marca mal y hay que corregir el número de
  // orden. Los avisos (duplicado, orden inexistente, estado) son informativos.
  const cotizacionCambio = cotizacion !== (fila.usdtRate != null ? String(fila.usdtRate) : '')
  const usdtPrevisto = Number(cotizacion) > 0 ? fila.monto / Number(cotizacion) : null

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    try {
      const body: Record<string, unknown> = { registroId: fila.registroId, storeId }
      if (orderNumber.trim() !== fila.orderNumber) body.orderNumber = orderNumber.trim()
      if (nombre !== fila.nombre) body.nombre = nombre
      if (cuit !== fila.cuit) body.cuit = cuit
      if (cotizacionCambio && Number(cotizacion) > 0) body.cotizacion = Number(cotizacion)

      const res = await fetch('/api/finanzas/registro/editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      const msg = [data.mensajeOrden, data.avisoSaldo].filter(Boolean).join(' — ')
      notify(msg || 'Registro actualizado ✓', msg ? 'info' : 'success')
      onGuardado()
      onCerrar()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onCerrar}>
      <div className="rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: '#00d4ff' }}>Editar registro</h3>
          <button onClick={onCerrar} className="text-xl leading-none" style={{ color: 'rgba(148,163,184,0.7)' }}>×</button>
        </div>
        <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
          Monto {ARS.format(fila.monto)} · no editable. Los cambios también se ven en el registro general.
        </p>

        <div>
          <label style={labelStyle}>N° de orden</label>
          <input style={inputStyle} value={orderNumber} onChange={e => setOrderNumber(e.target.value)} />
          {validando && <p className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.6)' }}>Buscando en la tienda…</p>}
          {validacion && !validando && <Avisos v={validacion} />}
        </div>

        <div>
          <label style={labelStyle}>Nombre y apellido</label>
          <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>CUIT / CUIL / DNI</label>
          <input style={inputStyle} value={cuit} onChange={e => setCuit(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>Cotización USDT</label>
          <MontoInput style={inputStyle} value={cotizacion} onChange={setCotizacion}
            placeholder={fila.usdtRate == null ? 'Pendiente' : ''} />
          {usdtPrevisto != null && (
            <p className="text-[11px] mt-1.5" style={{ color: cotizacionCambio ? '#fbbf24' : 'rgba(148,163,184,0.6)' }}>
              Equivale a <span className="font-bold">{fmtUsdt(usdtPrevisto)} USDT</span>
              {cotizacionCambio && ' · al guardar se recalcula el saldo de la tienda'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onCerrar} className="rounded-lg px-4 py-2 text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: 'rgba(148,163,184,0.8)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)' }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Los avisos no impiden guardar. El único que sí lo hace es el duplicado exacto.
function Avisos({ v }: { v: Validacion }) {
  const cajas: { color: string; borde: string; texto: React.ReactNode }[] = []

  if (v.duplicadoExacto) {
    cajas.push({
      color: '#fbbf24', borde: 'rgba(245,158,11,0.3)',
      texto: <>Ese número ya figura en otra entrada del registro de esta tienda
        {v.duplicadoExacto.cliente ? ` (${v.duplicadoExacto.cliente})` : ''}. Podés guardar igual.</>,
    })
  }
  // El sufijo "(n)" no existe en la tienda: se consultó la orden base.
  if (v.esPagoParcial) {
    cajas.push({
      color: 'rgba(148,163,184,0.85)', borde: 'rgba(148,163,184,0.2)',
      texto: <>El sufijo marca un pago en dos partes. En la tienda se buscó la orden <strong>#{v.ordenConsultada}</strong>.</>,
    })
  }

  if (v.errorTienda) {
    cajas.push({ color: '#fbbf24', borde: 'rgba(245,158,11,0.3)', texto: <>No se pudo consultar la tienda: {v.errorTienda}</> })
  } else if (!v.existe) {
    cajas.push({
      color: '#fbbf24', borde: 'rgba(245,158,11,0.3)',
      texto: <>La orden #{v.ordenConsultada} no existe en esta tienda. Podés guardarla igual.</>,
    })
  } else {
    const pagada = PAGADA.includes(String(v.paymentStatus))
    const cancelada = String(v.orderStatus) === 'cancelled'
    cajas.push({
      color: pagada && !cancelada ? '#00ff88' : '#fbbf24',
      borde: pagada && !cancelada ? 'rgba(0,255,136,0.3)' : 'rgba(245,158,11,0.3)',
      texto: <>Orden #{v.ordenConsultada} encontrada{v.cliente ? ` · ${v.cliente}` : ''}{v.total != null ? ` · ${ARS.format(v.total)}` : ''}
        {' · '}pago: <strong>{v.paymentStatus || '—'}</strong>{' · '}estado: <strong>{v.orderStatus || '—'}</strong>
        {cancelada && ' · está cancelada'}</>,
    })
  }
  if (v.similares.length) {
    cajas.push({
      color: '#fbbf24', borde: 'rgba(245,158,11,0.3)',
      texto: <>Esa misma orden ya figura en el registro como {v.similares.map(s => `#${s.orderNumber}`).join(', ')}.
        Suele ser un pago que vino en dos partes. Podés guardar igual.</>,
    })
  }

  return (
    <div className="space-y-1.5 mt-2">
      {cajas.map((c, i) => (
        <div key={i} className="text-[11px] px-3 py-2 rounded-lg leading-relaxed"
          style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${c.borde}`, color: c.color }}>
          {c.texto}
        </div>
      ))}
    </div>
  )
}
