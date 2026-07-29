'use client'

import { motion } from 'framer-motion'
import { fmtDate } from '@/lib/utils'
import { TIPO_LABEL, camposDeSolicitud, montoDeSolicitud } from '@/lib/transferencias-ui'
import type { TransferRequest } from '@/lib/types'
import BotonComprobante from './BotonComprobante'
import { Bloque, Linea } from './DetalleUI'

// ─────────────────────────────────────────────────────────────────────────────
// Detalle de UNA solicitud de transferencia, tal como la cargó la tienda.
// Es solo de lectura: sirve para verificar a quién se le pidió pagar y con qué
// datos, sin tener que acordarse de lo que se escribió al enviarla.
//
// Funciona igual con una pendiente y con una ya pagada; lo único que cambia es
// que la pagada suma cuándo se pagó, cuánto se descontó del saldo y el comprobante.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  solicitud: TransferRequest
  qs: string                 // query string del scope (vista espejo del admin)
  onClose: () => void
}

const ESTADO = {
  pagada:    { label: 'Pagada',    color: '#00ff88' },
  rechazada: { label: 'Rechazada', color: '#f87171' },
  pendiente: { label: 'Pendiente', color: '#fbbf24' },
} as const

export default function DetalleSolicitudModal({ solicitud: s, qs, onClose }: Props) {
  const campos = camposDeSolicitud(s.datos as Record<string, unknown>)
  const est = ESTADO[s.estado as keyof typeof ESTADO] ?? ESTADO.pendiente
  const d = s.descuento

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }}
        className="rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.25)' }}
        onClick={e => e.stopPropagation()}>

        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h3 className="text-base font-bold" style={{ color: 'rgba(226,232,240,0.95)' }}>
              {TIPO_LABEL[s.tipo]}
            </h3>
            <p className="text-xl font-black mt-0.5" style={{ color: '#00d4ff' }}>
              {montoDeSolicitud(s.tipo, s.datos as Record<string, unknown>)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
              style={{ background: `${est.color}1f`, border: `1px solid ${est.color}4d`, color: est.color }}>
              {est.label}
            </span>
            <button onClick={onClose} aria-label="Cerrar"
              className="text-xl leading-none px-1" style={{ color: 'rgba(148,163,184,0.7)', cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Datos que cargó la tienda — el motivo de existir de este modal */}
          <Bloque titulo="Datos de la transferencia">
            {campos.length === 0 ? (
              <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>Sin datos cargados.</p>
            ) : (
              <div className="space-y-2">
                {campos.map(c => (
                  <div key={c.label} className="flex items-start justify-between gap-4 text-xs">
                    <span className="shrink-0" style={{ color: 'rgba(148,163,184,0.65)' }}>{c.label}</span>
                    <span className="text-right break-all font-medium" style={{ color: 'rgba(226,232,240,0.92)' }}>{c.valor}</span>
                  </div>
                ))}
              </div>
            )}
          </Bloque>

          {/* Seguimiento */}
          <Bloque titulo="Seguimiento">
            <div className="space-y-2">
              <Linea label="Solicitada" valor={fmtDate(s.createdAt)} />
              {s.createdBy && <Linea label="Solicitada por" valor={s.createdBy} />}
              {s.concepto && <Linea label="Concepto" valor={s.concepto} />}
              {s.paidAt && (
                <Linea label={s.estado === 'rechazada' ? 'Rechazada' : 'Pagada'} valor={fmtDate(s.paidAt)} />
              )}
              {s.estado === 'pendiente' && (
                <p className="text-[11px] pt-1" style={{ color: 'rgba(251,191,36,0.8)' }}>
                  Todavía no se pagó: el saldo se descuenta recién cuando se realiza.
                </p>
              )}
            </div>
          </Bloque>

          {/* Impacto en el saldo — solo cuando ya se pagó */}
          {s.estado === 'pagada' && d && (
            <Bloque titulo="Descuento del saldo">
              <div className="space-y-2">
                <Linea label="Monto pagado" valor={`${Number(d.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d.moneda}`} />
                {Number(d.cotizacionUsdtArs) > 0 && (
                  <Linea label="Cotización USDT/ARS" valor={Number(d.cotizacionUsdtArs).toLocaleString('es-AR', { maximumFractionDigits: 2 })} />
                )}
                {Number(d.tasaUsdtUsd) > 0 && (
                  <Linea label="Tasa USDT/USD" valor={Number(d.tasaUsdtUsd).toLocaleString('es-AR', { maximumFractionDigits: 4 })} />
                )}
                <div className="flex items-center justify-between gap-4 text-xs pt-1"
                  style={{ borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: '8px' }}>
                  <span style={{ color: 'rgba(148,163,184,0.65)' }}>Descontado del saldo</span>
                  <span className="font-bold" style={{ color: '#f87171' }}>
                    −{Number(d.usdtDescontado).toLocaleString('es-AR', { maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
              </div>
            </Bloque>
          )}

          {s.estado === 'pagada' && s.comprobantePath && (
            <BotonComprobante href={`/api/tienda/comprobante?id=${s.id}${qs ? `&${qs.slice(1)}` : ''}`} />
          )}
        </div>
      </motion.div>
    </div>
  )
}
