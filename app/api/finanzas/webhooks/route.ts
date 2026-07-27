import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getClient } from '@/lib/storage'

// GET /api/finanzas/webhooks[?horas=48][&estado=duplicado]
//   → auditoría de los pagos que entran por webhook (Notificador, Copter).
//
// Contesta las tres preguntas que antes no se podían contestar:
//   1. ¿Llegó el pago?            → está o no está en la lista.
//   2. Si llegó y no se cargó, ¿por qué?  → estado + motivo.
//   3. ¿El endpoint estuvo caído? → `salud`: filas colgadas en 'recibido' (nos
//      morimos procesando), errores de saturación, y hace cuánto que no entra nada.
export const dynamic = 'force-dynamic'

const HORAS_DEFAULT = 48
const LIMITE = 500

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const horas = Math.min(Math.max(Number(req.nextUrl.searchParams.get('horas')) || HORAS_DEFAULT, 1), 24 * 30)
    const estado = req.nextUrl.searchParams.get('estado')
    const desde = new Date(Date.now() - horas * 3600_000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (getClient().from('webhook_ingresos') as any)
      .select('id, ts, fuente, estado, motivo, payment_id, id_externo, monto, titular, fecha_operacion, http_status, duration_ms')
      .gte('ts', desde)
      .order('ts', { ascending: false })
      .limit(LIMITE)
    if (estado) q = q.eq('estado', estado)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filas = (data ?? []) as any[]

    // Resumen por estado. 'aceptado' es lo normal; el resto merece una mirada.
    const porEstado: Record<string, number> = {}
    for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] ?? 0) + 1

    // ── Salud del endpoint ────────────────────────────────────────────────────
    // 'recibido' = entró pero nunca cerró: la función se murió en el medio
    // (timeout, saturación, un deploy justo ahí). Es LA señal de que el problema
    // fue nuestro, y es la que antes no existía.
    const colgados = filas.filter(f => f.estado === 'recibido')
    const saturado = filas.filter(f => f.estado === 'error' && /ocupado/i.test(f.motivo ?? ''))
    const ultimoAceptado = filas.find(f => f.estado === 'aceptado')
    const lentas = filas.filter(f => (f.duration_ms ?? 0) > 5000)

    return NextResponse.json({
      horas,
      total: filas.length,
      truncado: filas.length >= LIMITE,   // hay más: acotar el rango
      porEstado,
      salud: {
        colgados: colgados.length,
        colgadosDetalle: colgados.slice(0, 10),
        saturado: saturado.length,
        lentas: lentas.length,
        ultimoAceptadoTs: ultimoAceptado?.ts ?? null,
        minutosSinRecibir: ultimoAceptado
          ? Math.round((Date.now() - new Date(ultimoAceptado.ts).getTime()) / 60000)
          : null,
      },
      ingresos: filas,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
