import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Notificador — ACUSE DE RECIBO SOLAMENTE. Ya no carga pagos.
//
// Los pagos de la billetera "MS" entran por email (/api/lbfinanzas/webhook, los
// avisos de LB Finanzas). El bot de Notificador sigue posteando acá y no se lo
// quiere desconectar, así que este endpoint responde EXACTAMENTE lo mismo de
// siempre —incluido el bloque `interpretado`, para que del otro lado nada cambie—
// pero no guarda absolutamente nada: ni cola, ni registro, ni actividad, ni errores.
//
// Se borró todo lo demás: secret, lock, dedupe, corte por unidad y alta en la cola.
// No queda ninguna dependencia; si mañana se apaga el bot, se borra esta carpeta.
//
// OJO si se sigue limpiando: el source 'notificador' NO se puede sacar de
// PAYMENT_SOURCE_TO_WALLET ni de PAYMENT_SOURCE_NAMES (lib/config.ts). Hay ~2.200
// pagos históricos guardados con ese source; sin el mapeo caerían en la billetera
// "Otras" y se rompería el saldo y el historial de MS.
//
// La ruta sigue siendo pública en proxy.ts porque la llama un servicio externo.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await req.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (body.evento !== 'nuevo_ingreso') {
    return NextResponse.json({ success: true, skipped: true, reason: `Evento ignorado (no es nuevo_ingreso): ${body.evento}` })
  }

  // Se interpreta lo justo para devolver la misma respuesta de antes. No se valida
  // nada más: el pago no se carga igual, así que rechazarlo solo generaría ruido del
  // otro lado sin ningún beneficio.
  const d = body.datos ?? {}
  const fecha = new Date(d.fecha_operacion)

  return NextResponse.json({
    success: true,
    mpPaymentId: `notificador-${d.id_transaccion ?? ''}`,
    interpretado: {
      fecha: isNaN(fecha.getTime()) ? null : fecha.toISOString(),
      titular: typeof d.titular === 'string' ? d.titular.trim() : '',
      monto: Number(d.monto),
    },
  })
}
