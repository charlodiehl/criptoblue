// ─────────────────────────────────────────────────────────────────────────────
// Auditoría de los webhooks de pagos (Notificador, Copter, Bitso).
//
// Deja rastro de TODA request, entre o no entre el pago. Antes, los caminos que
// respondían 200 sin cargar nada (los chequeos de "duplicado") no registraban
// nada: si el que envía dice "mandé y me dieron OK" y el pago no está, no había
// con qué reconstruir qué pasó. Ahora sí.
//
// Uso en un webhook:
//     const audit = await abrirAuditoria('notificador', req, payload)
//     …
//     return audit.cerrar('duplicado', 'ya estaba en la cola',
//       NextResponse.json({ success: true, duplicate: true }))
//
// REGLA: auditar NUNCA puede tumbar un pago. Todo es best-effort — si la tabla
// falla, se sigue igual y se avisa por consola.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest, NextResponse } from 'next/server'
import { getClient } from './storage'

export type EstadoIngreso = 'recibido' | 'aceptado' | 'duplicado' | 'ignorado' | 'rechazado' | 'error'

// De qué webhook vino. Al agregar uno nuevo, sumarlo acá.
export type FuenteWebhook = 'notificador' | 'copter' | 'bitso'

// Datos del pago que se van conociendo a medida que se parsea el payload.
export interface DatosPago {
  paymentId?: string | null
  idExterno?: string | null
  monto?: number | null
  titular?: string | null
  fechaOperacion?: string | null
}

export interface Auditoria {
  /** Completa los datos del pago apenas se parsean (antes de cerrar). */
  datos(d: DatosPago): void
  /** Cierra la auditoría con el resultado final y devuelve la misma respuesta. */
  cerrar(estado: EstadoIngreso, motivo: string, res: NextResponse): Promise<NextResponse>
}

const TABLA = 'webhook_ingresos'

// Recorta un texto largo para no guardar basura enorme (user agents raros, etc.).
const corto = (v: unknown, max = 300) =>
  v == null ? null : String(v).slice(0, max)

const fechaValida = (v: unknown): string | null => {
  if (!v) return null
  const t = new Date(String(v)).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// Abre la auditoría: inserta la fila en 'recibido' con el payload CRUDO.
//
// Se inserta ANTES de procesar a propósito: si la función se muere en el medio
// (timeout, saturación, un deploy justo ahí), la fila queda en 'recibido' y eso
// mismo prueba que el pago llegó y que el problema fue nuestro. Sin esto, una
// caída no deja ninguna huella.
export async function abrirAuditoria(
  fuente: FuenteWebhook,
  req: NextRequest,
  payload: unknown,
): Promise<Auditoria> {
  const inicio = Date.now()
  let id: number | null = null
  let pendientes: DatosPago = {}

  try {
    const { data } = await getClient()
      .from(TABLA)
      .insert({
        fuente,
        estado: 'recibido',
        payload: payload ?? null,
        ip: corto(req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip'), 100),
        user_agent: corto(req.headers.get('user-agent'), 300),
      })
      .select('id')
      .single<{ id: number }>()
    id = data?.id ?? null
  } catch (e) {
    console.error('[webhook-audit] no se pudo abrir la auditoría:', e)
  }

  return {
    datos(d: DatosPago) {
      pendientes = { ...pendientes, ...d }
    },
    async cerrar(estado, motivo, res) {
      try {
        if (id != null) {
          await getClient().from(TABLA).update({
            estado,
            motivo: corto(motivo, 500),
            payment_id: corto(pendientes.paymentId, 200),
            id_externo: corto(pendientes.idExterno, 200),
            monto: Number.isFinite(Number(pendientes.monto)) ? Number(pendientes.monto) : null,
            titular: corto(pendientes.titular, 200),
            fecha_operacion: fechaValida(pendientes.fechaOperacion),
            http_status: res.status,
            duration_ms: Date.now() - inicio,
          }).eq('id', id)
        }
      } catch (e) {
        console.error('[webhook-audit] no se pudo cerrar la auditoría:', e)
      }
      return res
    },
  }
}
