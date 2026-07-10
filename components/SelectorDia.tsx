'use client'

import { useState, useRef, useEffect, useMemo } from 'react'

// Calendario que solo deja elegir días con movimiento. El <input type="date"> nativo
// no permite deshabilitar fechas sueltas (solo min/max), así que se dibuja la grilla
// a mano. Todo se maneja como 'YYYY-MM-DD' en horario Argentina: nunca se construye
// un Date con la fecha local del navegador, para no correr el día por zona horaria.

const DIAS_SEMANA = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const ymd = (a: number, m: number, d: number) =>
  `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// Días del mes, y en qué columna (lunes=0) arranca el día 1. Se usa Date.UTC para
// que el cálculo no dependa de la zona del navegador.
function grilla(anio: number, mes: number) {
  const total = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  const domingoCero = new Date(Date.UTC(anio, mes, 1)).getUTCDay()   // 0 = domingo
  const offset = (domingoCero + 6) % 7                                // 0 = lunes
  return { total, offset }
}

export default function SelectorDia({ value, dias, onChange, disabled = false }: {
  value: string                 // 'YYYY-MM-DD'
  dias: string[]                // días habilitados
  onChange: (dia: string) => void
  disabled?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const habilitados = useMemo(() => new Set(dias), [dias])
  const [anio, setAnio] = useState(() => Number(value.slice(0, 4)))
  const [mes, setMes] = useState(() => Number(value.slice(5, 7)) - 1)

  // Al abrir, posicionarse en el mes del día elegido. Se hace acá y no en un efecto:
  // un setState dentro de useEffect dispara un render en cascada innecesario.
  const abrir = () => {
    if (!abierto) { setAnio(Number(value.slice(0, 4))); setMes(Number(value.slice(5, 7)) - 1) }
    setAbierto(v => !v)
  }

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const { total, offset } = grilla(anio, mes)
  const primero = dias[0]
  const ultimo = dias[dias.length - 1]

  const mover = (paso: number) => {
    let a = anio, m = mes + paso
    if (m < 0) { m = 11; a-- } else if (m > 11) { m = 0; a++ }
    setAnio(a); setMes(m)
  }
  const hayAntes = dias.some(d => d < ymd(anio, mes, 1))
  const hayDespues = dias.some(d => d > ymd(anio, mes, total))

  const texto = value ? value.split('-').reverse().join('/') : 'Elegir día'

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={abrir}
        className="rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.35)', color: 'rgba(226,232,240,0.9)' }}
      >
        <span>{texto}</span>
        <span style={{ color: 'rgba(0,212,255,0.7)' }}>▾</span>
      </button>

      {abierto && (
        <div className="absolute left-0 mt-2 z-50 rounded-xl p-3 w-[280px]"
          style={{ background: '#0d1117', border: '1px solid rgba(0,212,255,0.2)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>
              {MESES[mes]} de {anio}
            </span>
            <div className="flex gap-1">
              <button type="button" disabled={!hayAntes} onClick={() => mover(-1)}
                className="w-7 h-7 rounded-lg text-sm disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ background: 'rgba(0,212,255,0.06)', color: '#00d4ff' }}>←</button>
              <button type="button" disabled={!hayDespues} onClick={() => mover(1)}
                className="w-7 h-7 rounded-lg text-sm disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ background: 'rgba(0,212,255,0.06)', color: '#00d4ff' }}>→</button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => <div key={`v${i}`} />)}
            {Array.from({ length: total }, (_, i) => i + 1).map(d => {
              const iso = ymd(anio, mes, d)
              const activo = habilitados.has(iso)
              const elegido = iso === value
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!activo}
                  title={activo ? undefined : 'Sin movimientos este día'}
                  onClick={() => { onChange(iso); setAbierto(false) }}
                  className="h-8 rounded-lg text-xs font-medium transition-all disabled:cursor-not-allowed"
                  style={elegido
                    ? { background: 'rgba(0,212,255,0.2)', border: '1px solid rgba(0,212,255,0.6)', color: '#00d4ff' }
                    : activo
                      ? { background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.18)', color: 'rgba(226,232,240,0.9)' }
                      : { background: 'transparent', border: '1px solid transparent', color: 'rgba(148,163,184,0.2)' }}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-3 text-[11px]">
            <button type="button" disabled={!primero} onClick={() => { onChange(primero); setAbierto(false) }}
              className="disabled:opacity-30" style={{ color: '#00d4ff' }}>Primero</button>
            <span style={{ color: 'rgba(148,163,184,0.45)' }}>{dias.length} día{dias.length === 1 ? '' : 's'} con movimiento</span>
            <button type="button" disabled={!ultimo} onClick={() => { onChange(ultimo); setAbierto(false) }}
              className="disabled:opacity-30" style={{ color: '#00d4ff' }}>Último</button>
          </div>
        </div>
      )}
    </div>
  )
}
