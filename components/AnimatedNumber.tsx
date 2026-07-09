'use client'

import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useTransform, animate, useAnimationControls, useReducedMotion } from 'framer-motion'

// ─────────────────────────────────────────────────────────────────────────────
// Número animado: cuenta de 0 → valor al aparecer, y tween del valor anterior →
// nuevo cuando cambia (p. ej. entró una orden). Un "pop" (escala) marca el cambio.
// Respeta prefers-reduced-motion (salta directo al valor final).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  value: number
  format: (n: number) => string
  className?: string
  style?: React.CSSProperties
  duration?: number
  /** Pulso de escala cuando el valor cambia (no en el primer render). */
  pop?: boolean
}

export default function AnimatedNumber({ value, format, className, style, duration = 0.9, pop = true }: Props) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const text = useTransform(mv, (n: number) => format(n))
  const controls = useAnimationControls()
  const mounted = useRef(false)

  useEffect(() => {
    if (reduce) { mv.set(value); mounted.current = true; return }
    const anim = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] })
    if (pop && mounted.current) {
      // color/escala breve para llamar la atención sobre el cambio
      controls.start({ scale: [1, 1.07, 1], transition: { duration: 0.45, ease: 'easeOut' } })
    }
    mounted.current = true
    return () => anim.stop()
  }, [value, duration, pop, reduce, mv, controls])

  return (
    <motion.span animate={controls} className={className} style={{ display: 'inline-block', willChange: 'transform', ...style }}>
      {text}
    </motion.span>
  )
}

// Barra "esqueleto" pulsante para estados de carga (reemplaza el rígido "—").
export function NumberSkeleton({ width = 120, height = 34, className }: { width?: number | string; height?: number; className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={className}
      initial={{ opacity: 0.35 }}
      animate={{ opacity: [0.35, 0.7, 0.35] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        display: 'inline-block', width, height, borderRadius: 8, verticalAlign: 'middle',
        background: 'linear-gradient(90deg, rgba(148,163,184,0.10), rgba(148,163,184,0.24), rgba(148,163,184,0.10))',
      }}
    />
  )
}
