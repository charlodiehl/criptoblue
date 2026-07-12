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

// raw (lo tipeado/pegado, con mis puntos de miles incluidos) → { display, clean }.
//
// Separador decimal: se acepta COMA o PUNTO indistintamente, y siempre se muestra
// como coma. La única sutileza es no confundir el punto DECIMAL con los puntos de
// MILES que la vista agrega sola en grupos de 3:
//   • Una coma es siempre decimal (la vista nunca la usa para miles).
//   • Un punto es decimal solo si es el último separador y tiene < 3 dígitos detrás
//     (0, 1 o 2). Con 3 o más, son puntos de miles. Así:
//       "1.234"        → miles → 1234        (como se ve 1234 en Argentina)
//       "1.5" / "1.50" → decimal
//       "1234.56"      → decimal → 1.234,56  (pegado con punto decimal)
//       "1.234,56"     → decimal (manda la coma) → 1.234,56
// Emite por `clean` un string con punto decimal (parseable directo con Number()).
export function parseMontoInput(raw: string): { display: string; clean: string } {
  const s = raw.replace(/[^\d.,]/g, '')

  let intPart: string
  let decPart: string | undefined
  const iComma = s.lastIndexOf(',')
  const iDot = s.lastIndexOf('.')
  if (iComma !== -1) {
    intPart = s.slice(0, iComma)         // la coma manda como decimal
    decPart = s.slice(iComma + 1)
  } else if (iDot !== -1 && s.slice(iDot + 1).replace(/\D/g, '').length < 3) {
    intPart = s.slice(0, iDot)           // punto con < 3 dígitos detrás = decimal
    decPart = s.slice(iDot + 1)
  } else {
    intPart = s                          // sin separador decimal (o puntos de miles)
    decPart = undefined
  }

  const intClean = intPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '') // solo dígitos, sin ceros a la izquierda
  const decClean = decPart === undefined ? undefined : decPart.replace(/\D/g, '').slice(0, 2) // máx 2 decimales
  const intFmt = intClean === '' ? '' : Number(intClean).toLocaleString('es-AR')

  const display = decClean !== undefined ? `${intFmt === '' ? '0' : intFmt},${decClean}` : intFmt

  let clean = ''
  if (intClean !== '') {
    clean = intClean
    if (decClean) clean += '.' + decClean
  } else if (decClean) {
    clean = '0.' + decClean
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
