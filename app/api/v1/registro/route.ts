import { NextRequest, NextResponse } from 'next/server'
import { validarApiKey, llamadasRecientes, marcarUso, auditarRequest } from '@/lib/api-keys'
import { getRegistroRango } from '@/lib/registro-api'
import { getStores } from '@/lib/storage'
import { setUnidad } from '@/lib/unidad'

// GET /api/v1/registro?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// API pública (ruta pública en proxy.ts) con su propia auth por API key.
// Devuelve el registro diario de la tienda dueña de la key en el rango pedido.
// Node runtime: api-keys usa `crypto` (hash de la key).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_LIMIT = 10          // llamadas
const RATE_WINDOW_SEG = 60     // por minuto
const MAX_DIAS = 180           // rango y antigüedad máximos

const FMT = /^\d{4}-\d{2}-\d{2}$/
const diaMs = 24 * 3600_000

export async function GET(req: NextRequest) {
  const started = Date.now()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null
  const sp = req.nextUrl.searchParams
  const desde = sp.get('desde')
  const hasta = sp.get('hasta')

  let keyId: number | null = null
  let storeId: string | null = null
  let diasDevueltos: number | null = null

  const done = async (
    status: number, body: unknown,
    opts: { headers?: Record<string, string>; auditError?: string } = {},
  ) => {
    const error = opts.auditError
      ?? (status >= 400 && body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null)
    await auditarRequest({
      storeId, keyId, endpoint: '/api/v1/registro', desde, hasta, status, error,
      ip, userAgent: ua, durationMs: Date.now() - started, diasDevueltos,
    })
    return NextResponse.json(body, { status, headers: opts.headers })
  }

  try {
    // 1. Auth por API key (Authorization: Bearer <key>)
    const authz = req.headers.get('authorization') ?? ''
    const key = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
    if (!key) return done(401, { error: 'Falta la API key. Enviala en el header Authorization: Bearer <key>' })
    const val = await validarApiKey(key)
    if (!val.ok) {
      return val.reason === 'revoked'
        ? done(403, { error: 'La API key fue revocada' })
        : done(401, { error: 'API key inválida' })
    }
    keyId = val.keyId
    storeId = val.storeId
    // La unidad de negocio la define la propia key, y se aplica ACÁ, en el frame del
    // handler: de acá en adelante la API solo ve datos de esa unidad (ver lib/unidad.ts).
    setUnidad(val.unidad)

    // 2. Rate limit (10/min por key, contado desde el propio audit log)
    if (await llamadasRecientes(keyId, RATE_WINDOW_SEG) >= RATE_LIMIT) {
      return done(429,
        { error: `Límite de ${RATE_LIMIT} llamadas por minuto alcanzado`, retryAfter: RATE_WINDOW_SEG },
        { headers: { 'Retry-After': String(RATE_WINDOW_SEG) } })
    }

    // 3. Validación de fechas
    if (!desde || !hasta) return done(400, { error: 'Faltan los parámetros "desde" y "hasta" (formato YYYY-MM-DD)' })
    if (!FMT.test(desde) || !FMT.test(hasta)) return done(400, { error: 'Fechas mal formadas: usar YYYY-MM-DD' })
    const t0 = new Date(`${desde}T00:00:00-03:00`).getTime()
    const t1 = new Date(`${hasta}T00:00:00-03:00`).getTime()
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return done(400, { error: 'Fechas inválidas' })
    if (t0 > t1) return done(400, { error: '"desde" no puede ser posterior a "hasta"' })
    if ((t1 - t0) / diaMs > MAX_DIAS) return done(422, { error: `El rango no puede superar los ${MAX_DIAS} días` })
    const hoyART = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const limite = new Date(`${hoyART}T00:00:00-03:00`).getTime() - MAX_DIAS * diaMs
    if (t0 < limite) return done(422, { error: `No se sirven datos anteriores a ${MAX_DIAS} días. Pedilos por privado.` })

    // 4. La tienda de la key tiene que existir / estar conectada
    const stores = await getStores()
    const store = stores[storeId]
    if (!store) return done(404, { error: 'La tienda de esta key no existe o está desconectada' })

    // 5. Cómputo + respuesta
    const data = await getRegistroRango(storeId, store.storeName, desde, hasta)
    diasDevueltos = data.dias.length
    await marcarUso(keyId)
    return done(200, data)
  } catch (err) {
    // El detalle real queda en el audit/log, NUNCA se filtra al caller.
    console.error('[api/v1/registro] error:', err)
    return done(500, { error: 'Error interno' }, { auditError: err instanceof Error ? err.message : String(err) })
  }
}

// Cualquier otro método → 405 JSON (nunca fallar en silencio).
function metodoNoPermitido() {
  return NextResponse.json({ error: 'Método no permitido: solo GET' }, { status: 405, headers: { Allow: 'GET' } })
}
export const POST = metodoNoPermitido
export const PUT = metodoNoPermitido
export const PATCH = metodoNoPermitido
export const DELETE = metodoNoPermitido
