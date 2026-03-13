'use client'

import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

interface Stats {
  paidThisMonth: number
  paidVolumeThisMonth: number
  pendingOrders: number
  pendingPayments: number
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
  sublabel: string
  value: number
  format?: (n: number) => string
  color: string
  glow: string
  borderColor: string
  icon: React.ReactNode
  delay: number
}

function StatCard({ label, sublabel, value, format, color, glow, borderColor, icon, delay }: StatCardProps) {
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
      <div className="absolute top-0 right-0 w-28 h-28 opacity-10 rounded-full pointer-events-none"
        style={{ background: color, filter: 'blur(32px)', transform: 'translate(30%, -30%)' }} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1 leading-tight" style={{ color: 'rgba(148,163,184,0.7)' }}>
            {label}
          </p>
          <p className="text-xs mb-3 leading-tight" style={{ color: 'rgba(148,163,184,0.4)' }}>
            {sublabel}
          </p>
          <p className="text-4xl font-black" style={{ color, textShadow: `0 0 20px ${color}60` }}>
            <AnimatedNumber value={value} format={format} />
          </p>
        </div>
        <div className="shrink-0 mt-1" style={{ color, opacity: 0.7 }}>
          {icon}
        </div>
      </div>
    </motion.div>
  )
}

export default function StatsBar({ stats, pendingPairs, ordersCount }: { stats: Stats | null; pendingPairs: number; ordersCount: number }) {
  const s = stats || { paidThisMonth: 0, paidVolumeThisMonth: 0, pendingOrders: 0, pendingPayments: 0 }

  const now = new Date()
  const monthName = now.toLocaleDateString('es-AR', { month: 'long' })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Órdenes marcadas como pagadas"
        sublabel={`Este mes (${monthName}) · se reinicia el 1ro`}
        value={s.paidThisMonth}
        color="#00ff88"
        glow="0 0 20px rgba(0,255,136,0.08)"
        borderColor="rgba(0,255,136,0.2)"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
          </svg>
        }
        delay={0}
      />
      <StatCard
        label="Emparejamientos pendientes"
        sublabel="Pagos con ≥2 señales coincidentes con una orden"
        value={pendingPairs}
        color="#f59e0b"
        glow="0 0 20px rgba(245,158,11,0.08)"
        borderColor="rgba(245,158,11,0.2)"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clipRule="evenodd" />
          </svg>
        }
        delay={0.06}
      />
      <StatCard
        label="Órdenes sin identificar"
        sublabel="Pendientes de pago · últimas 48hs"
        value={ordersCount}
        color="#f87171"
        glow="0 0 20px rgba(248,113,113,0.08)"
        borderColor="rgba(248,113,113,0.2)"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
            <path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" />
            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clipRule="evenodd" />
          </svg>
        }
        delay={0.12}
      />
      <StatCard
        label="Volumen identificado"
        sublabel={`Suma de pagos con orden asignada (${monthName})`}
        value={s.paidVolumeThisMonth}
        format={n => ARS.format(n)}
        color="#00d4ff"
        glow="0 0 20px rgba(0,212,255,0.08)"
        borderColor="rgba(0,212,255,0.2)"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
            <path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
            <path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" />
            <path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" />
          </svg>
        }
        delay={0.18}
      />
    </div>
  )
}
