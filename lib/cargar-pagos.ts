// Detección de columnas por nombre de header + normalización de valores para la
// carga de pagos desde una planilla Excel. Diseñado para ajustar fácil cuando se
// conozca el formato exacto del archivo (basta tocar SINONIMOS / parseMonto / parseFecha).

export type PagoCampo = 'nombre' | 'monto' | 'fecha' | 'cuit' | 'email' | 'orden' | 'referencia'

// Sinónimos de header → campo (todo se compara normalizado: minúsculas, sin acentos).
const SINONIMOS: Record<PagoCampo, string[]> = {
  monto:      ['monto', 'importe', 'total', 'monto pagado', 'valor', 'pago ars', 'importe ars', 'monto ars'],
  // 'nombre destino' primero (más específico). NO incluir 'titular': suele ser el
  // dueño de la cuenta, no el pagador real.
  nombre:     ['nombre destino', 'nombre y apellido', 'apellido y nombre', 'nombre', 'remitente', 'pagador', 'ordenante', 'cliente'],
  fecha:      ['fecha y hora', 'fecha hora', 'fecha pago', 'fecha de pago', 'fecha'],
  cuit:       ['cuit', 'cuil', 'dni', 'documento', 'cuit cuil dni', 'cuit dni', 'doc', 'nro documento'],
  email:      ['email', 'correo', 'e mail', 'mail', 'correo electronico'],
  orden:      ['orden', 'nro de orden', 'numero de orden', 'n de orden', 'numero orden', 'order', 'pedido', 'nro orden'],
  referencia: ['referencia', 'trx', 'concepto', 'detalle', 'operacion', 'comprobante', 'banco', 'observaciones'],
}

export function normalizeHeader(h: unknown): string {
  return (h ?? '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Mapea cada header (por índice) a un campo. Devuelve el mapping campo→índice
// y el campo detectado para cada header (para mostrarlo en la UI).
export function detectColumns(headers: unknown[]): {
  mapping: Partial<Record<PagoCampo, number>>
  headerCampo: (PagoCampo | null)[]
} {
  const mapping: Partial<Record<PagoCampo, number>> = {}
  const headerCampo: (PagoCampo | null)[] = []
  headers.forEach((raw, idx) => {
    const h = normalizeHeader(raw)
    let matched: PagoCampo | null = null
    if (h) {
      for (const campo of Object.keys(SINONIMOS) as PagoCampo[]) {
        if (SINONIMOS[campo].some(s => h === s || h.includes(s))) { matched = campo; break }
      }
    }
    headerCampo.push(matched)
    if (matched && mapping[matched] === undefined) mapping[matched] = idx // el primero que matchea gana
  })
  return { mapping, headerCampo }
}

// "$ 107.324,32" → 107324.32 · "55.920" → 55920 · soporta formato AR y US.
export function parseMonto(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/[^\d,.-]/g, '') // dejar dígitos , . -
  if (!s) return null
  const hasComma = s.includes(','), hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // el separador decimal es el que aparece último
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const tho = dec === ',' ? '.' : ','
    s = s.split(tho).join('').replace(dec, '.')
  } else if (hasComma) {
    s = s.replace(',', '.')                 // coma decimal (AR)
  } else if (hasDot) {
    const parts = s.split('.')
    // varios puntos, o un grupo de exactamente 3 dígitos → son miles
    if (parts.length > 2 || (parts[1] && parts[1].length === 3)) s = parts.join('')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Fecha → ISO con offset AR (-03:00). Acepta Date (de exceljs) o string DD/MM/YYYY [HH:mm].
export function parseFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().replace('Z', '-03:00') // (se afina con el formato real del archivo)
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const d = m[1], mo = m[2]; let y = m[3]
    if (y.length === 2) y = '20' + y
    const pad = (x: string | undefined, n = 2) => (x ?? '0').padStart(n, '0')
    return `${y}-${pad(mo)}-${pad(d)}T${pad(m[4])}:${pad(m[5])}:${pad(m[6])}.000-03:00`
  }
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? null : dt.toISOString().replace('Z', '-03:00')
}

export function parseCuit(v: unknown): string {
  return (v ?? '').toString().replace(/\D/g, '')
}

export interface PagoPreview {
  fila: number
  nombre: string
  monto: number | null
  fecha: string | null
  cuit: string
  email: string
  orden: string
  referencia: string
  warnings: string[]
}

// Firma de un pago para deduplicar: misma fecha+hora, nombre y monto = mismo pago.
// Se usa para omitir, al cargar un Excel, los pagos que ya están en la app.
export function pagoFirma(monto: number | null, fecha: string | null, nombre: string): string {
  const m = monto === null || !Number.isFinite(monto) ? '' : monto.toFixed(2)
  const f = (fecha || '').trim()
  const n = (nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return `${m}|${f}|${n}`
}

// Construye el set de firmas ya existentes para una billetera (source), tomando
// los pagos de la cola (unmatched) + los del registro. Funciones puras: los
// datos los traen los endpoints (storage + registro_log).
export function buildSigSet(
  cola: { payment?: { source?: string; monto: number; fechaPago: string; nombrePagador: string } | null }[],
  registro: { monto: number | null; fecha: string; nombre: string }[],
  source: string,
): Set<string> {
  const set = new Set<string>()
  for (const u of cola) {
    const p = u.payment
    if (p && p.source === source) set.add(pagoFirma(p.monto, p.fechaPago, p.nombrePagador))
  }
  for (const r of registro) set.add(pagoFirma(r.monto, r.fecha, r.nombre))
  return set
}

export function normalizeRow(row: unknown[], mapping: Partial<Record<PagoCampo, number>>, fila: number): PagoPreview {
  const get = (campo: PagoCampo) => (mapping[campo] !== undefined ? row[mapping[campo]!] : undefined)
  const monto = parseMonto(get('monto'))
  const fecha = parseFecha(get('fecha'))
  const warnings: string[] = []
  if (monto === null) warnings.push('monto inválido o ausente')
  if (!fecha) warnings.push('fecha inválida o ausente')
  return {
    fila,
    nombre: (get('nombre') ?? '').toString().trim(),
    monto,
    fecha,
    cuit: parseCuit(get('cuit')),
    email: (get('email') ?? '').toString().trim(),
    orden: (get('orden') ?? '').toString().trim().replace(/\.0$/, ''),
    referencia: (get('referencia') ?? '').toString().trim(),
    warnings,
  }
}
