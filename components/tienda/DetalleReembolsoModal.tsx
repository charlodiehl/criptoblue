'use client'

import { motion } from 'framer-motion'
import { ARS, fmtDate } from '@/lib/utils'
import type { RefundRequest } from '@/lib/types'
import BotonComprobante from './BotonComprobante'
import { Bloque, Linea } from './DetalleUI'

// ─────────────────────────────────────────────────────────────────────────────
// Detalle de UNA solicitud de reembolso, tal como la cargó la tienda. Espejo de
// DetalleSolicitudModal (transferencias): solo lectura, sirve para verificar a qué
// cuenta se pidió que devuelvan la plata sin acordarse de lo que se escribió.
//
// Funciona igual con una pendiente y con una ya reembolsada; lo que cambia es que
// la resuelta suma cuándo y quién la resolvió, y el comprobante.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  solicitud: RefundRequest
  qs: string                 // query string del scope (vista espejo del admin)
  onClose: () => void
}

const ESTADO = {
  procesada: { label: 'Reembolsada', color: '#00ff88' },
  rechazada: { label: 'Rechazada',   color: '#f87171' },
  pendiente: { label: 'Pendiente',   color: '#fbbf24' },
} as const

export default function DetalleReembolsoModal({ solicitud: s, qs, onClose }: Props) {
  const est = ESTADO[s.estado as keyof typeof ESTADO] ?? ESTADO.pendiente

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
              Reembolso · Orden #{s.orderNumber}
            </h3>
            <p className="text-xl font-black mt-0.5" style={{ color: '#00d4ff' }}>
              {s.montoSolicitado != null ? ARS.format(s.montoSolicitado) : '—'}
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
          <Bloque titulo="Datos del reembolso">
            <div className="space-y-2">
              <Linea label="N° de orden" valor={`#${s.orderNumber}`} />
              {s.orderTotal != null && <Linea label="Total de la orden" valor={ARS.format(s.orderTotal)} />}
              <Linea label="Monto solicitado" valor={s.montoSolicitado != null ? ARS.format(s.montoSolicitado) : '—'} />
              {/* Las solicitudes anteriores a esta feature no tienen destino cargado. */}
              <Linea label="Alias o CBU" valor={s.aliasCbu || '—'} />
              <Linea label="Titular" valor={s.titular || '—'} />
            </div>
          </Bloque>

          {/* Seguimiento */}
          <Bloque titulo="Seguimiento">
            <div className="space-y-2">
              <Linea label="Solicitada" valor={fmtDate(s.createdAt)} />
              {s.createdBy && <Linea label="Solicitada por" valor={s.createdBy} />}
              {s.processedAt && (
                <Linea label={s.estado === 'rechazada' ? 'Rechazada' : 'Reembolsada'} valor={fmtDate(s.processedAt)} />
              )}
              {/* processedBy (quién la resolvió) NO se muestra: es una cuenta interna
                  nuestra, y el detalle de transferencias tampoco muestra quién pagó. */}
              {s.estado === 'pendiente' && (
                <p className="text-[11px] pt-1" style={{ color: 'rgba(251,191,36,0.8)' }}>
                  Todavía no se reembolsó: el saldo se descuenta recién cuando se realiza.
                </p>
              )}
            </div>
          </Bloque>

          {s.estado === 'procesada' && s.refundId && s.comprobanteDisponible && (
            <BotonComprobante href={`/api/tienda/comprobante-reembolso?id=${s.refundId}${qs ? `&${qs.slice(1)}` : ''}`} />
          )}
        </div>
      </motion.div>
    </div>
  )
}
