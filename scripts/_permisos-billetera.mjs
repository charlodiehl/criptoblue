// Permisos de billetera para los scripts de alta de usuarios. Espejo de lib/permisos.ts
// (que es la fuente para la app); acá se repite porque los scripts son .mjs y no pasan
// por el bundler de Next.
//
// Se acepta la lista de claves (administracion,registrar_retiros,ver_saldo) y también
// los atajos viejos editor|lectura, que es lo que la app usaba antes y sigue vivo en
// la columna billetera_permiso.

export const CLAVES = ['administracion', 'registrar_retiros', 'ver_saldo']

// Devuelve el objeto de permisos, o null si la entrada no es válida.
export function parsePermisosBilletera(entrada) {
  const txt = (entrada || '').toLowerCase().trim()
  if (!txt) return null
  if (txt === 'editor') return { registrar_retiros: true, ver_saldo: true }
  if (txt === 'lectura') return { ver_saldo: true }

  const partes = txt.split(',').map(s => s.trim()).filter(Boolean)
  if (!partes.length || partes.some(p => !CLAVES.includes(p))) return null
  const out = {}
  for (const p of partes) out[p] = true
  // Administración implica todos los permisos (misma regla que la app).
  if (out.administracion) for (const k of CLAVES) out[k] = true
  return out
}

// La columna vieja billetera_permiso sigue siendo NOT NULL para role='billetera'
// (CHECK de migrations/2026-07-rol-billetera.sql): se mantiene en sync.
export function permisoLegacy(permisos) {
  return permisos.administracion || permisos.registrar_retiros ? 'editor' : 'lectura'
}

export const AYUDA_PERMISOS = `Permisos inválidos. Usá una lista separada por comas de: ${CLAVES.join(', ')} (o los atajos editor | lectura)`
