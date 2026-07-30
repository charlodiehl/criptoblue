// ─────────────────────────────────────────────────────────────────────────────
// Cliente de la API de Bitso (billetera "Bitso FluoGames", unidad MS).
//
// Reemplaza al circuito por email: antes un Apps Script leía los avisos y posteaba
// a un webhook, y el pago se armaba parseando texto. Acá los datos vienen tipados y
// completos — incluido el CUIT del pagador, que el aviso por mail no traía.
//
// Solo LECTURA: la credencial se genera en Bitso con permisos de ver saldos e info de
// la cuenta, nada de retiros. Este módulo únicamente consulta.
//
// AUTENTICACIÓN: cada request lleva un header
//     Authorization: Bitso <key>:<nonce>:<firma>
// donde la firma es HMAC-SHA256 de (nonce + MÉTODO + path + body) usando el secret.
// El path DEBE incluir el query string, si no la firma no valida.
// El nonce tiene que crecer en cada llamada: se usa el timestamp en milisegundos.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from 'crypto'

const BASE = 'https://api.bitso.com'

// Un depósito recibido. Solo los campos que se usan; Bitso manda bastantes más.
export interface FundingBitso {
  fid: string
  status: string           // 'complete' | 'pending' | 'failed' | …
  created_at: string       // ISO con offset
  currency: string         // 'ars'
  amount: string           // viene como string: "2000000.00000000"
  method_name?: string
  details?: {
    sender_name?: string
    sender_cuitcuil?: string
    sender_address?: string   // CBU/CVU de origen
    sender_scheme?: string    // 'CVU' | 'CBU'
    sender_bank?: string
  }
}

function credenciales(): { key: string; secret: string } {
  const key = process.env.BITSO_API_KEY
  const secret = process.env.BITSO_API_SECRET
  if (!key || !secret) throw new Error('Faltan BITSO_API_KEY / BITSO_API_SECRET en el servidor')
  return { key, secret }
}

async function get(path: string, timeoutMs = 15_000): Promise<unknown> {
  const { key, secret } = credenciales()
  const nonce = Date.now().toString()
  // El body va vacío en los GET, pero forma parte del mensaje firmado igual.
  const firma = createHmac('sha256', secret).update(nonce + 'GET' + path).digest('hex')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bitso ${key}:${nonce}:${firma}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    const cuerpo = await res.text()
    if (!res.ok) throw new Error(`Bitso ${path} devolvió HTTP ${res.status}: ${cuerpo.slice(0, 200)}`)
    const json = JSON.parse(cuerpo)
    if (!json?.success) throw new Error(`Bitso ${path} rechazó la consulta: ${JSON.stringify(json?.error ?? json).slice(0, 200)}`)
    return json.payload
  } finally {
    clearTimeout(timer)
  }
}

// Depósitos recibidos, del más nuevo al más viejo. Se pagina con `marker` hasta
// cubrir `desde`, con un tope de páginas para que un error de fecha no dispare una
// consulta infinita (el rate limit de Bitso es 300 requests por minuto).
export async function getDepositos(desde: Date, maxPaginas = 10): Promise<FundingBitso[]> {
  const out: FundingBitso[] = []
  let marker: string | undefined

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const qs = new URLSearchParams({ limit: '100' })
    if (marker) qs.set('marker', marker)
    const lote = (await get(`/v3/fundings/?${qs.toString()}`)) as FundingBitso[]
    if (!Array.isArray(lote) || lote.length === 0) break

    out.push(...lote)

    // Si el más viejo del lote ya está antes del piso, no hace falta seguir.
    const masViejo = lote[lote.length - 1]
    if (masViejo?.created_at && new Date(masViejo.created_at).getTime() < desde.getTime()) break
    if (lote.length < 100) break
    marker = masViejo?.fid
  }

  return out.filter(f => f.created_at && new Date(f.created_at).getTime() >= desde.getTime())
}

// Valida la credencial sin traer movimientos. Para diagnóstico.
export async function getEstadoCuenta(): Promise<{ clientId?: string; status?: string }> {
  const p = (await get('/v3/account_status/')) as { client_id?: string; status?: string }
  return { clientId: p?.client_id, status: p?.status }
}
