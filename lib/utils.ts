// Utilidades compartidas entre componentes

// Devuelve el timestamp actual en hora Argentina (UTC-3) como ISO 8601
// Ej: "2026-04-09T15:23:45.000-03:00" cuando son las 18:23 UTC
// Al parsearlo con new Date() vuelve al instante UTC correcto → los cálculos de corte siguen funcionando
export function nowART(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace('Z', '-03:00')
}

// Devuelve la fecha actual en Argentina como "YYYY-MM-DD" (para claves de audit log, etc.)
export function todayART(): string {
  return nowART().slice(0, 10)
}

export const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  // Argentina es UTC-3 fijo (sin DST) — calculamos manualmente para evitar
  // que Intl.DateTimeFormat devuelva año en 2 dígitos en algunos browsers con locale es-AR
  const arg = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const dd   = String(arg.getUTCDate()).padStart(2, '0')
  const mm   = String(arg.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = arg.getUTCFullYear()
  const hh   = String(arg.getUTCHours()).padStart(2, '0')
  const min  = String(arg.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

export function matchesSearch(query: string, fields: (string | number | undefined | null)[]): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim().replace(/[$.,']/g, '')
  return fields.some(f => {
    if (f == null) return false
    return String(f).toLowerCase().replace(/[$.,']/g, '').includes(q)
  })
}
