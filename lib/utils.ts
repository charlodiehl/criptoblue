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
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}

export function matchesSearch(query: string, fields: (string | number | undefined | null)[]): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim().replace(/[$.,']/g, '')
  return fields.some(f => {
    if (f == null) return false
    return String(f).toLowerCase().replace(/[$.,']/g, '').includes(q)
  })
}
