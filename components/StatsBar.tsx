'use client'

import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

interface Stats {
  pendingMatch: number
  manualPaid: number
  noMatch: number
  totalAmount: number
  processedPayments: number
}

function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const motionVal = useMotionValue(0)
  const spring = useSpring(motionVal, { stiffness: 80, damping: 18 })
  const display = useTransform(spring, v => format ? format(Math.round(v)) : String(Math.round(v)))
  const prevRef = useRef(0)

  useEffect(() => {
    motionVal.set(prevRef.current)
    spring.set(prevRef.current)
    motionVal.set(value)
    prevRef.current = value
  }, [value, motionVal, spring])

  return <motion.span>{display}</motion.span>
}

interface StatCardProps {
  label: string
  value: number
  format?: (n: number) => string
  color: string
  glow: string
  borderColor: string
  icon: string
  delay: number
}

function StatCard({ label, value, format, color, glow, borderColor, icon, delay }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="relative rounded-2xl p-5 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)',
        border: `1px solid ${borderColor}`,
        boxShadow: glow,
      }}
    >
      {/* Corner accent */}
      <div className="absolute top-0 right-0 w-24 h-24 opacity-10 rounded-full pointer-events-none"
        style={{ background: color, filter: 'blur(30px)', transform: 'translate(30%, -30%)' }} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.7)' }}>
            {label}
          </p>
          <p className="text-3xl font-black stat-value" style={{ color, textShadow: `0 0 20px ${color}60` }}>
            <AnimatedNumber value={value} format={format} />
          </p>
        </div>
        <div className="text-2xl opacity-70">{icon}</div>
      </div>
    </motion.div>
  )
}

export default function StatsBar({ stats }: { stats: Stats | null }) {
  const s = stats || { pendingMatch: 0, manualPaid: 0, noMatch: 0, totalAmount: 0, processedPayments: 0 }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="En revisión"
        value={s.pendingMatch}
        color="#f59e0b"
        glow="0 0 20px rgba(245,158,11,0.08)"
        borderColor="rgba(245,158,11,0.2)"
        icon="⏳"
        delay={0}
      />
      <StatCard
        label="Pagados"
        value={s.manualPaid}
        color="#00ff88"
        glow="0 0 20px rgba(0,255,136,0.08)"
        borderColor="rgba(0,255,136,0.2)"
        icon="✓"
        delay={0.05}
      />
      <StatCard
        label="Sin match"
        value={s.noMatch}
        color="#f87171"
        glow="0 0 20px rgba(248,113,113,0.08)"
        borderColor="rgba(248,113,113,0.2)"
        icon="✕"
        delay={0.1}
      />
      <StatCard
        label="Total procesado"
        value={s.totalAmount}
        format={n => ARS.format(n)}
        color="#00d4ff"
        glow="0 0 20px rgba(0,212,255,0.1)"
        borderColor="rgba(0,212,255,0.2)"
        icon="$"
        delay={0.15}
      />
      <StatCard
        label="Procesados"
        value={s.processedPayments}
        color="#a78bfa"
        glow="0 0 20px rgba(167,139,250,0.08)"
        borderColor="rgba(167,139,250,0.2)"
        icon="⚡"
        delay={0.2}
      />
    </div>
  )
}
