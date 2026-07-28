'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Input de monto con separador de miles en vivo, hasta 2 decimales. Muestra el
// número formateado mientras se escribe y emite por onChange un string "limpio"
// con punto decimal (parseable directo con Number()).
//
// El padre guarda ese string limpio como su estado (ej. "151000", "1575.4", "").
// Como el limpio no tiene coma, los parseos existentes tipo Number(x.replace(',','.'))
// siguen andando sin tocarlos.
//
// DOS FORMATOS DE VISTA. El `clean` que se emite es el MISMO en los dos, así que el
// padre y el servidor no se enteran de cuál se está usando:
//   'es-AR' (default) → miles "." y decimal ","   →  145.414,8
//   'en-US'           → miles "," y decimal "."   →  145,414.8
//
// El 'en-US' existe por una razón práctica, no estética: el monto a reembolsar se
// copia y se pega en una billetera que exige punto decimal; con coma, la billetera
// descarta los decimales. Es TEMPORAL — cuando eso se resuelva, se saca el prop
// `formato` de ese campo y vuelve al default sin tocar nada más.
// ─────────────────────────────────────────────────────────────────────────────

export type FormatoMonto = 'es-AR' | 'en-US'

// Separadores de cada formato.
const SEP: Record<FormatoMonto, { miles: string; dec: string }> = {
  'es-AR': { miles: '.', dec: ',' },
  'en-US': { miles: ',', dec: '.' },
}

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
export function parseMontoInput(raw: string, formato: FormatoMonto = 'es-AR'): { display: string; clean: string } {
  const s = raw.replace(/[^\d.,]/g, '')
  const { dec: sepDec, miles: sepMiles } = SEP[formato]

  // El separador DECIMAL del formato manda siempre. El de MILES solo cuenta como
  // decimal si es el último y tiene menos de 3 dígitos detrás (con 3 o más son los
  // miles que la vista agrega sola). Misma regla en los dos formatos, con los
  // caracteres dados vuelta.
  let intPart: string
  let decPart: string | undefined
  const iDec = s.lastIndexOf(sepDec)
  const iMiles = s.lastIndexOf(sepMiles)
  if (iDec !== -1) {
    intPart = s.slice(0, iDec)
    decPart = s.slice(iDec + 1)
  } else if (iMiles !== -1 && s.slice(iMiles + 1).replace(/\D/g, '').length < 3) {
    intPart = s.slice(0, iMiles)
    decPart = s.slice(iMiles + 1)
  } else {
    intPart = s                          // sin separador decimal (o solo miles)
    decPart = undefined
  }

  const intClean = intPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '') // solo dígitos, sin ceros a la izquierda
  const decClean = decPart === undefined ? undefined : decPart.replace(/\D/g, '').slice(0, 2) // máx 2 decimales
  const intFmt = intClean === '' ? '' : Number(intClean).toLocaleString(formato)

  const display = decClean !== undefined ? `${intFmt === '' ? '0' : intFmt}${sepDec}${decClean}` : intFmt

  let clean = ''
  if (intClean !== '') {
    clean = intClean
    if (decClean) clean += '.' + decClean
  } else if (decClean) {
    clean = '0.' + decClean
  }

  return { display, clean }
}

// string limpio ("151000" / "1575.4") → formateado para mostrar.
export function cleanToDisplay(clean: string, formato: FormatoMonto = 'es-AR'): string {
  if (clean == null || clean === '') return ''
  const [i, d] = clean.split('.')
  const intFmt = i === '' ? '0' : Number(i).toLocaleString(formato)
  return d !== undefined ? `${intFmt}${SEP[formato].dec}${d}` : intFmt
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
  // Solo para el monto a reembolsar (ver el comentario de arriba). Default: es-AR.
  formato?: FormatoMonto
}

export default function MontoInput({ value, onChange, formato = 'es-AR', ...rest }: Props) {
  const [display, setDisplay] = useState(() => cleanToDisplay(value, formato))
  const [lastValue, setLastValue] = useState(value)

  // Reformatear solo cuando el valor cambia POR FUERA (precarga/reset), no mientras
  // se tipea — así se preservan estados intermedios como una coma final "1.500,".
  // Patrón oficial de React: ajustar estado durante el render (sin useEffect).
  if (value !== lastValue) {
    setLastValue(value)
    setDisplay(cleanToDisplay(value, formato))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { display: d, clean } = parseMontoInput(e.target.value, formato)
    setDisplay(d)
    setLastValue(clean) // este valor ya queda reflejado en el display tipeado
    onChange(clean)
  }

  // Al copiar/cortar, los separadores de MILES son SOLO visuales: se sacan del texto
  // que va al portapapeles (así "97.485" se pega como "97485"). El decimal se conserva.
  // Con formato 'en-US' esto deja el monto listo para pegar en la billetera:
  // "145,414.8" se copia como "145414.8". Devuelve null si no había nada que sacar
  // (comportamiento normal del navegador).
  const reMiles = formato === 'en-US' ? /,/g : /\./g
  function textoSinMiles(input: HTMLInputElement): string | null {
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? 0
    const sel = start !== end ? input.value.slice(start, end) : input.value
    const limpio = sel.replace(reMiles, '')
    return limpio === sel ? null : limpio
  }

  function handleCopy(e: React.ClipboardEvent<HTMLInputElement>) {
    const limpio = textoSinMiles(e.currentTarget)
    if (limpio == null) return
    e.clipboardData.setData('text/plain', limpio)
    e.preventDefault()
  }

  function handleCut(e: React.ClipboardEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? 0
    if (start === end) return // sin selección no hay nada que cortar
    e.clipboardData.setData('text/plain', input.value.slice(start, end).replace(reMiles, ''))
    e.preventDefault()
    // El navegador no toca el input (preventDefault): quito la parte cortada y re-parseo.
    const { display: d, clean } = parseMontoInput(input.value.slice(0, start) + input.value.slice(end), formato)
    setDisplay(d); setLastValue(clean); onChange(clean)
  }

  return <input type="text" inputMode="decimal" value={display} onChange={handleChange} onCopy={handleCopy} onCut={handleCut} {...rest} />
}
