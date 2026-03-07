'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { PendingMatch } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? '#00ff88' : score >= 65 ? '#f59e0b' : '#f87171'
  const label = score >= 85 ? 'Alto' : score >= 65 ? 'Medio' : 'Bajo'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{score}% <span className="font-normal opacity-60">{label}</span></span>
    </div>
  )
}

function Insight({ label, value, ok, warn }: { label: string; value: string; ok: boolean; warn: boolean }) {
  const color = ok ? '#00ff88' : warn ? '#f59e0b' : 'rgba(148,163,184,0.5)'
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span style={{ color: 'rgba(148,163,184,0.6)' }}>{label}</span>
      <span className="font-semibold" style={{ color }}>{value}</span>
    </div>
  )
}

function MatchCard({ match, onApprove, onDismiss, loading }: {
  match: PendingMatch
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
  loading: string | null
}) {
  const { payment, order, score, scores, thirdParty } = match
  const id = match.mpPaymentId || ''
  const isLoading = loading === id
  const amountDiff = Math.abs(payment.monto - order.total)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)',
        border: '1px solid rgba(0,212,255,0.12)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,212,255,0.03)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <ScoreBar score={score} />
          {thirdParty && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
              Tercero
            </span>
          )}
          <span className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>{fmtDate(match.matchedAt)}</span>
        </div>
        <div className="flex gap-2">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onDismiss(id)}
            disabled={isLoading}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(148,163,184,0.8)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Descartar
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.04, boxShadow: '0 0 20px rgba(0,255,136,0.4)' }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onApprove(id)}
            disabled={isLoading}
            className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all"
            style={{
              background: isLoading ? 'rgba(0,255,136,0.1)' : 'linear-gradient(135deg, #00ff8888, #00cc66)',
              boxShadow: isLoading ? 'none' : '0 0 12px rgba(0,255,136,0.25)',
              color: '#00ff88',
              border: '1px solid rgba(0,255,136,0.3)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border border-green-400 border-t-transparent animate-spin" />
                Procesando
              </span>
            ) : '✓ Confirmar pago'}
          </motion.button>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-3">
        {/* Payment */}
        <div className="p-5 space-y-2" style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.6)' }}>
            Transferencia MP
          </p>
          <p className="text-2xl font-black text-white" style={{ textShadow: '0 0 20px rgba(0,212,255,0.3)' }}>
            {ARS.format(payment.monto)}
          </p>
          <p className="text-sm font-medium text-gray-300">{payment.nombrePagador || <span className="italic text-gray-600">Sin nombre</span>}</p>
          {payment.emailPagador && <p className="text-xs text-gray-500">{payment.emailPagador}</p>}
          {payment.cuitPagador && <p className="text-xs text-gray-600">CUIL: {payment.cuitPagador}</p>}
          <p className="text-xs text-gray-600">{payment.metodoPago}</p>
          <p className="text-xs text-gray-600">{fmtDate(payment.fechaPago)}</p>
          {payment.referencia && <p className="text-xs text-gray-600 truncate">Ref: {payment.referencia}</p>}
        </div>

        {/* Comparison */}
        <div className="p-5 space-y-2" style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.6)' }}>
            Señales de match
          </p>
          <div className="space-y-1">
            <Insight label="Monto" value={amountDiff === 0 ? 'Exacto' : `Dif. ${ARS.format(amountDiff)}`} ok={amountDiff <= 10} warn={amountDiff <= 500} />
            <Insight label="Nombre" value={`${scores.name || 0}%`} ok={(scores.name || 0) >= 70} warn={(scores.name || 0) >= 40} />
            <Insight label="Email" value={`${scores.email || 0}%`} ok={(scores.email || 0) >= 80} warn={(scores.email || 0) >= 50} />
            <Insight label="DNI/CUIL" value={(scores.dni || 0) >= 100 ? '✓ Coincide' : 'No disponible'} ok={(scores.dni || 0) >= 100} warn={false} />
            <Insight label="Referencia" value={(scores.reference || 0) >= 80 ? '✓ Match' : 'Sin match'} ok={(scores.reference || 0) >= 80} warn={false} />
            <Insight label="Timing" value={`${scores.timing || 0}%`} ok={(scores.timing || 0) >= 80} warn={(scores.timing || 0) >= 40} />
          </div>
        </div>

        {/* Order */}
        <div className="p-5 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.6)' }}>
            Pedido TiendaNube
          </p>
          <p className="text-2xl font-black text-white">{ARS.format(order.total)}</p>
          <p className="text-sm font-medium text-gray-300">{order.customerName}</p>
          {order.customerEmail && <p className="text-xs text-gray-500">{order.customerEmail}</p>}
          {order.customerCuit && <p className="text-xs text-gray-600">DNI: {order.customerCuit}</p>}
          <p className="text-xs font-bold" style={{ color: '#00d4ff' }}>#{order.orderNumber}</p>
          <p className="text-xs text-gray-600">{fmtDate(order.createdAt)}</p>
          <p className="text-xs text-gray-600">{order.storeName}</p>
        </div>
      </div>
    </motion.div>
  )
}

interface Props {
  matches: PendingMatch[]
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
  loading: string | null
}

export default function MatchTable({ matches, onApprove, onDismiss, loading }: Props) {
  if (matches.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
        style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.08)' }}
      >
        <div className="text-5xl mb-4" style={{ filter: 'drop-shadow(0 0 20px rgba(0,255,136,0.5))' }}>✓</div>
        <p className="font-semibold text-gray-300">No hay matches pendientes</p>
        <p className="text-sm mt-1 text-gray-600">Corré el ciclo MP para buscar nuevos pagos</p>
      </motion.div>
    )
  }

  const high = matches.filter(m => m.score >= 80)
  const mid = matches.filter(m => m.score >= 65 && m.score < 80)
  const low = matches.filter(m => m.score < 65)

  function renderGroup(title: string, items: PendingMatch[], color: string) {
    if (!items.length) return null
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${color}40)` }} />
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
            {title} · {items.length}
          </span>
          <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${color}40, transparent)` }} />
        </div>
        <AnimatePresence mode="popLayout">
          {items.map((m, i) => (
            <motion.div key={m.mpPaymentId} transition={{ delay: i * 0.04 }}>
              <MatchCard match={m} onApprove={onApprove} onDismiss={onDismiss} loading={loading} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {renderGroup('Confianza alta', high, '#00ff88')}
      {renderGroup('Confianza media', mid, '#f59e0b')}
      {renderGroup('Confianza baja', low, '#f87171')}
    </div>
  )
}
