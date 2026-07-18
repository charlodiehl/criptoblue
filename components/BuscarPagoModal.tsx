'use client'

import { useState, useRef, useEffect } from 'react'
import MontoInput from '@/components/MontoInput'
import type { Order, Payment, Store } from '@/lib/types'
import { ARS, fmtDate } from '@/lib/utils'
import { parseComprobante } from '@/lib/ocr-comprobante'

// ── Helpers de fecha (la app trabaja en horario AR, -03:00) ──
// ISO con offset AR → valor para <input type="datetime-local"> ('YYYY-MM-DDTHH:mm')
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]}T${m[2]}` : ''
}
// Valor de datetime-local → ISO con offset AR
function localInputToISO(local: string): string {
  if (!local) return ''
  return `${local}:00.000-03:00`
}


interface PagoResultado {
  payment: Payment
  enCola: boolean
  yaEmparejado: boolean
}

interface OrdenResultado {
  order: Order
  paymentStatus: string
  orderStatus: string
  alreadyInCache: boolean
  logDuplicate?: { orderNumber: string; storeName: string; timestamp: string; confidence: 'alta' | 'media' } | null
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: 'white', outline: 'none',
  boxSizing: 'border-box', colorScheme: 'dark',
}
const labelStyle: React.CSSProperties = {
  fontSize: '10px', color: 'rgba(148,163,184,0.5)', letterSpacing: '0.08em',
  textTransform: 'uppercase', display: 'block', marginBottom: '4px',
}

export default function BuscarPagoModal({
  stores, onClose, onEmparejado,
}: {
  stores: Store[]
  onClose: () => void
  onEmparejado: (msg: string) => void
}) {
  // OCR / comprobante
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrText, setOcrText] = useState('')   // texto crudo del OCR (para diagnóstico)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Campos editables
  const [nombre, setNombre] = useState('')
  const [monto, setMonto] = useState('')
  const [fechaLocal, setFechaLocal] = useState('')

  // Búsqueda de pago en la app (cola + emparejados)
  const [buscandoPago, setBuscandoPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)
  const [resultadosPago, setResultadosPago] = useState<PagoResultado[] | null>(null)
  const [pagoSel, setPagoSel] = useState<Payment | null>(null)

  // Selección de orden
  const [storeId, setStoreId] = useState(stores[0]?.storeId || '')
  const [orderNumber, setOrderNumber] = useState('')
  const [buscandoOrden, setBuscandoOrden] = useState(false)
  const [ordenError, setOrdenError] = useState<string | null>(null)
  const [orden, setOrden] = useState<OrdenResultado | null>(null)

  // Emparejado
  const [emparejando, setEmparejando] = useState(false)

  // Cargar imagen (file o paste) y correr OCR
  const procesarImagen = async (file: File) => {
    setImgUrl(URL.createObjectURL(file))
    setOcrLoading(true)
    setOcrProgress(0)
    try {
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('spa', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100))
        },
      })
      // PSM AUTO (3) es CLAVE: el default de tesseract.js trata la imagen como un
      // único bloque y se SALTEA líneas grandes aisladas como el monto ("$ 52.920").
      // Con AUTO segmenta el documento y las lee. Verificado contra comprobantes reales.
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO })
      const { data } = await worker.recognize(file)
      await worker.terminate()
      setOcrText(data.text || '')
      const parsed = parseComprobante(data.text || '')
      // Solo autocompletar campos vacíos / siempre que OCR detecte algo
      if (parsed.nombrePagador) setNombre(parsed.nombrePagador)
      if (parsed.monto != null) setMonto(String(parsed.monto))
      if (parsed.fechaISO) setFechaLocal(isoToLocalInput(parsed.fechaISO))
    } catch (err) {
      setPagoError(`No se pudo leer la imagen: ${String(err)}`)
    } finally {
      setOcrLoading(false)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) procesarImagen(file)
  }

  // Pegar captura desde el portapapeles
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
      if (item) {
        const file = item.getAsFile()
        if (file) procesarImagen(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const buscarPago = async () => {
    setPagoError(null)
    setResultadosPago(null)
    setPagoSel(null)
    setOrden(null)
    const montoNum = parseFloat(monto.replace(',', '.'))
    if (!Number.isFinite(montoNum) || montoNum <= 0) { setPagoError('Ingresá un monto válido'); return }
    if (!fechaLocal) { setPagoError('Ingresá la fecha y hora del pago'); return }
    setBuscandoPago(true)
    try {
      const res = await fetch('/api/buscar-pago', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: montoNum, fechaISO: localInputToISO(fechaLocal) }),
      })
      const data = await res.json()
      if (!res.ok) { setPagoError(data.error || 'Error al buscar el pago'); return }
      setResultadosPago(data.resultados)
      // Si hay exactamente uno disponible, seleccionarlo automáticamente
      if (data.resultados.length === 1 && !data.resultados[0].yaEmparejado) {
        setPagoSel(data.resultados[0].payment)
      }
    } catch (err) {
      setPagoError(String(err))
    } finally {
      setBuscandoPago(false)
    }
  }

  const buscarOrden = async () => {
    setOrdenError(null)
    setOrden(null)
    if (!orderNumber.trim() || !storeId) return
    setBuscandoOrden(true)
    try {
      const res = await fetch('/api/buscar-orden', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: orderNumber.trim(), storeId }),
      })
      const data = await res.json()
      if (!res.ok) { setOrdenError(data.error || 'Error al buscar la orden'); return }
      if (data.notFound) { setOrdenError('No se encontró ninguna orden con ese número en esa tienda.'); return }
      setOrden(data)
    } catch (err) {
      setOrdenError(String(err))
    } finally {
      setBuscandoOrden(false)
    }
  }

  const emparejar = async () => {
    if (!pagoSel || !orden?.order || emparejando) return
    setEmparejando(true)
    try {
      const res = await fetch('/api/emparejar-pago-mp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment: pagoSel, order: orden.order }),
      })
      const data = await res.json()
      if (!res.ok) { setOrdenError(data.error || 'Error al emparejar'); return }
      onEmparejado(`✓ Pago emparejado con orden #${orden.order.orderNumber}`)
      onClose()
    } catch (err) {
      setOrdenError(String(err))
    } finally {
      setEmparejando(false)
    }
  }

  const ordenPagada = (orden?.paymentStatus || '').toLowerCase() === 'paid'
  const ordenCancelada = (orden?.orderStatus || '').toLowerCase() === 'cancelled'
  const bloqueaEmparejar = !pagoSel || !orden?.order || ordenPagada || ordenCancelada || emparejando

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'linear-gradient(160deg, #0d1117 0%, #0f1824 100%)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '520px', marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(0,212,255,0.9)', letterSpacing: '0.04em' }}>Buscar Pagos</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.5)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        {/* Zona de comprobante */}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{ border: '1px dashed rgba(0,212,255,0.3)', borderRadius: '10px', padding: imgUrl ? '8px' : '20px', marginBottom: '14px', textAlign: 'center', cursor: 'pointer', background: 'rgba(0,212,255,0.03)' }}>
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="comprobante" style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '6px' }} />
          ) : (
            <div style={{ fontSize: '12px', color: 'rgba(148,163,184,0.6)' }}>
              📎 Hacé clic para elegir el comprobante<br />
              <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)' }}>o pegá una captura con Ctrl+V</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        </div>
        {ocrLoading && (
          <div style={{ fontSize: '11px', color: 'rgba(0,212,255,0.7)', marginBottom: '12px' }}>
            Leyendo comprobante… {ocrProgress}%
          </div>
        )}

        {/* Campos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Nombre del pagador</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Detectado por OCR o manual" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Monto pagado *</label>
              <MontoInput value={monto} onChange={v => { setMonto(v); setResultadosPago(null); setPagoSel(null) }} placeholder="0" style={inputStyle} />
            </div>
            <div style={{ flex: 1.3 }}>
              <label style={labelStyle}>Fecha y hora del pago *</label>
              <input type="datetime-local" value={fechaLocal} onChange={e => { setFechaLocal(e.target.value); setResultadosPago(null); setPagoSel(null) }} style={inputStyle} />
            </div>
          </div>
          <button onClick={buscarPago} disabled={buscandoPago}
            style={{ fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.08)', color: 'rgba(0,212,255,0.85)', cursor: buscandoPago ? 'not-allowed' : 'pointer', opacity: buscandoPago ? 0.5 : 1 }}>
            {buscandoPago ? 'Buscando…' : '🔎 Buscar pago'}
          </button>

          {/* Texto detectado por el OCR — para diagnosticar cuando un comprobante se lee mal */}
          {ocrText && (
            <details style={{ marginTop: '2px' }}>
              <summary style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', cursor: 'pointer', userSelect: 'none' }}>
                Ver texto detectado por el OCR
              </summary>
              <pre style={{ marginTop: '6px', maxHeight: '160px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '10px', lineHeight: 1.4, color: 'rgba(148,163,184,0.7)', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(148,163,184,0.15)', borderRadius: '7px', padding: '8px 10px' }}>
                {ocrText}
              </pre>
            </details>
          )}
        </div>

        {pagoError && (
          <div style={{ padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.85)' }}>{pagoError}</div>
        )}

        {/* Resultados de pago */}
        {resultadosPago && resultadosPago.length === 0 && (
          <div style={{ padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: 'rgba(251,191,36,0.9)' }}>
            ⚠ No se encontró ningún pago en la app con ese monto y fecha (±24 h).
          </div>
        )}
        {resultadosPago && resultadosPago.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)', marginBottom: '6px' }}>
              {resultadosPago.length === 1 ? 'Pago encontrado:' : `${resultadosPago.length} pagos encontrados:`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {resultadosPago.map(r => {
                const sel = pagoSel?.mpPaymentId === r.payment.mpPaymentId
                return (
                  <div key={r.payment.mpPaymentId}
                    onClick={() => !r.yaEmparejado && setPagoSel(r.payment)}
                    style={{ padding: '10px 12px', borderRadius: '8px', cursor: r.yaEmparejado ? 'not-allowed' : 'pointer',
                      border: sel ? '1px solid rgba(0,255,136,0.5)' : '1px solid rgba(148,163,184,0.15)',
                      background: sel ? 'rgba(0,255,136,0.06)' : 'rgba(0,0,0,0.25)', opacity: r.yaEmparejado ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: 'white' }}>{ARS.format(r.payment.monto)}</span>
                      <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.5)' }}>{fmtDate(r.payment.fechaPago)}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(148,163,184,0.55)', marginTop: '2px' }}>
                      {r.payment.nombrePagador || 'Sin nombre'} · {r.payment.metodoPago}
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(148,163,184,0.4)', marginTop: '2px' }}>ID: {r.payment.mpPaymentId}</div>
                    {r.yaEmparejado && <div style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', marginTop: '4px' }}>✕ Este pago YA fue emparejado con una orden</div>}
                    {!r.yaEmparejado && r.enCola && <div style={{ fontSize: '11px', color: 'rgba(251,191,36,0.8)', marginTop: '4px' }}>Está en la cola de pagos sin emparejar</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Selector de orden — solo si hay un pago seleccionado */}
        {pagoSel && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(226,232,240,0.8)', marginBottom: '10px' }}>Emparejar con una orden</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              {stores.length > 1 && (
                <div>
                  <label style={labelStyle}>Tienda</label>
                  <select value={storeId} onChange={e => { setStoreId(e.target.value); setOrden(null); setOrdenError(null) }}
                    style={{ ...inputStyle, background: '#1a2235' }}>
                    {stores.map(s => <option key={s.storeId} value={s.storeId}>{s.storeName}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Número de orden</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input type="text" value={orderNumber} onChange={e => { setOrderNumber(e.target.value); setOrden(null); setOrdenError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') buscarOrden() }} placeholder="Ej: 79849" style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={buscarOrden} disabled={buscandoOrden || !orderNumber.trim()}
                    style={{ fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.08)', color: 'rgba(0,212,255,0.85)', cursor: 'pointer', opacity: (buscandoOrden || !orderNumber.trim()) ? 0.4 : 1, whiteSpace: 'nowrap' }}>
                    {buscandoOrden ? '…' : 'Buscar orden'}
                  </button>
                </div>
              </div>
            </div>

            {ordenError && (
              <div style={{ padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.85)' }}>{ordenError}</div>
            )}

            {/* Resultado de la orden */}
            {orden?.order && (
              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: '10px', padding: '14px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '20px', fontWeight: 800, color: 'white' }}>{ARS.format(orden.order.total)}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#00d4ff' }}>#{orden.order.orderNumber}</span>
                </div>
                {orden.order.customerName && <p style={{ fontSize: '13px', color: 'rgba(226,232,240,0.85)', marginTop: '4px' }}>{orden.order.customerName}</p>}
                {orden.order.customerCuit && <p style={{ fontSize: '11px', color: 'rgba(0,212,255,0.6)', marginTop: '2px' }}>CUIT/DNI: {orden.order.customerCuit}</p>}
                <p style={{ fontSize: '11px', color: 'rgba(148,163,184,0.45)', marginTop: '2px' }}>{orden.order.storeName} · {fmtDate(orden.order.createdAt)}</p>

                {/* Diferencia de monto pago vs orden */}
                {pagoSel && Math.abs(pagoSel.monto - orden.order.total) > 0.01 && (
                  <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '7px', fontSize: '11px', color: 'rgba(251,191,36,0.9)' }}>
                    ⚠ El pago ({ARS.format(pagoSel.monto)}) no coincide con el total de la orden ({ARS.format(orden.order.total)})
                  </div>
                )}
                {/* Estados */}
                {ordenPagada && <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '7px', fontSize: '11px', color: 'rgba(248,113,113,0.9)' }}>✕ Esta orden ya está marcada como pagada</div>}
                {ordenCancelada && <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '7px', fontSize: '11px', color: 'rgba(248,113,113,0.9)' }}>✕ Esta orden está cancelada</div>}
                {orden.logDuplicate && (
                  <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '7px', fontSize: '11px', color: 'rgba(251,191,36,0.95)' }}>
                    ⚠ Posible duplicado · Orden #{orden.logDuplicate.orderNumber} con mismo {orden.logDuplicate.confidence === 'alta' ? 'cliente y monto' : 'nombre y monto'} ya marcada el {fmtDate(orden.logDuplicate.timestamp)}
                  </div>
                )}

                <button onClick={emparejar} disabled={bloqueaEmparejar}
                  style={{ width: '100%', marginTop: '12px', fontSize: '13px', fontWeight: 700, padding: '9px 12px', borderRadius: '8px', border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.08)', color: '#00ff88', cursor: bloqueaEmparejar ? 'not-allowed' : 'pointer', opacity: bloqueaEmparejar ? 0.4 : 1 }}>
                  {emparejando ? 'Emparejando…' : '✓ Emparejar pago con esta orden'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
