// Utilidades compartidas entre componentes

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
