'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Input de monto con separador de miles en vivo (formato es-AR: miles ".", decimal
// ",", hasta 2 decimales). Muestra el número formateado mientras se escribe y emite
// por onChange un string "limpio" con punto decimal (parseable directo con Number()).
//
// El padre guarda ese string limpio como su estado (ej. "151000", "1575.4", "").
// Como el limpio no tiene coma, los parseos existentes tipo Number(x.replace(',','.'))
// siguen andando sin tocarlos.
// ─────────────────────────────────────────────────────────────────────────────

// raw (lo tipeado, con mis puntos de miles incluidos) → { display formateado, clean }
export function parseMontoInput(raw: string): { display: string; clean: string } {
  // Solo dígitos y coma: los "." son separadores de miles y se ignoran al parsear.
  const soloValidos = raw.replace(/[^\d,]/g, '')
  const iComma = soloValidos.indexOf(',')
  let intRaw: string
  let decRaw: string | undefined
  if (iComma === -1) {
    intRaw = soloValidos
    decRaw = undefined
  } else {
    intRaw = soloValidos.slice(0, iComma)
    decRaw = soloValidos.slice(iComma + 1).replace(/,/g, '').slice(0, 2)
  }
  const intClean = intRaw.replace(/^0+(?=\d)/, '') // sin ceros a la izquierda
  const intFmt = intClean === '' ? '' : Number(intClean).toLocaleString('es-AR')

  const display = decRaw !== undefined ? `${intFmt === '' ? '0' : intFmt},${decRaw}` : intFmt

  let clean = ''
  if (intClean !== '') {
    clean = intClean
    if (decRaw !== undefined && decRaw !== '') clean += '.' + decRaw
  } else if (decRaw !== undefined && decRaw !== '') {
    clean = '0.' + decRaw
  }

  return { display, clean }
}

// string limpio ("151000" / "1575.4") → formateado es-AR para mostrar.
export function cleanToDisplay(clean: string): string {
  if (clean == null || clean === '') return ''
  const [i, d] = clean.split('.')
  const intFmt = i === '' ? '0' : Number(i).toLocaleString('es-AR')
  return d !== undefined ? `${intFmt},${d}` : intFmt
}

interface Props {
  value: string                                 // string limpio del padre
  onChange: (clean: string) => void
  placeholder?: string
  style?: React.CSSProperties
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export default function MontoInput({ value, onChange, ...rest }: Props) {
  const [display, setDisplay] = useState(() => cleanToDisplay(value))
  const [lastValue, setLastValue] = useState(value)

  // Reformatear solo cuando el valor cambia POR FUERA (precarga/reset), no mientras
  // se tipea — así se preservan estados intermedios como una coma final "1.500,".
  // Patrón oficial de React: ajustar estado durante el render (sin useEffect).
  if (value !== lastValue) {
    setLastValue(value)
    setDisplay(cleanToDisplay(value))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { display: d, clean } = parseMontoInput(e.target.value)
    setDisplay(d)
    setLastValue(clean) // este valor ya queda reflejado en el display tipeado
    onChange(clean)
  }

  return <input type="text" inputMode="decimal" value={display} onChange={handleChange} {...rest} />
}
