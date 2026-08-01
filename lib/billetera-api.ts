import { getExtractoBilleteraRango, type MovimientoDia, type PagoBilletera } from '@/lib/billeteras'

// ─────────────────────────────────────────────────────────────────────────────
// Motor por RANGO para la API pública de billeteras (GET /api/v1/billetera).
// Espejo de lib/registro-api.ts, que hace lo mismo para tiendas.
//
// NO recalcula nada: pide el extracto del rango —el MISMO que arma el panel y el
// Excel de la billetera— y lo agrupa por día. Así la API no puede desviarse de lo
// que ve el admin en pantalla, que es el error clásico de tener dos motores.
//
// Diferencias con la de tiendas, porque el negocio es distinto:
//   • el saldo de una billetera se lleva en ARS, no en USDT: no hay cotización
//   • un pago figura en el día en que ENTRÓ la plata, no en el del emparejamiento
//   • puede haber pagos sin orden ni tienda: los pendientes, y todos los de las
//     billeteras que no emparejan órdenes (Bitso FluoGames, LB CriptoBlue)
// ─────────────────────────────────────────────────────────────────────────────

export interface PagoIngreso {
  hora: string                 // ISO con offset -03:00
  titular: string | null
  cuit: string | null          // solo lo informan algunas fuentes (Bitso por API sí)
  ars: number
  comision_ars: number
  estado: 'emparejado' | 'pendiente' | 'reembolsado'
  tienda: string | null        // null si el pago todavía no emparejó (o nunca empareja)
  orden: string | null
}
export interface RetiroBilletera {
  hora: string
  concepto: string
  moneda: string | null        // moneda ORIGINAL del retiro (ARS/USD/USDT)
  monto: number | null         // monto en esa moneda
  cotizacion: number | null    // ARS por unidad; null si el retiro ya era en ARS
  ars: number                  // lo que se descontó del saldo
}
export interface ReembolsoBilleteraApi { hora: string; concepto: string; tienda: string | null; ars: number }
export interface AjusteBilletera { hora: string; concepto: string; ars: number }

export interface DiaBilletera {
  fecha: string
  ingresos: { ars: number; cantidad: number; pagos: PagoIngreso[] }
  comision: { pct: number; ars: number }
  retiros: RetiroBilletera[]
  reembolsos: ReembolsoBilleteraApi[]
  ajustes: AjusteBilletera[]
  saldo_neto_dia_ars: number
}
export interface RegistroBilleteraRango {
  billetera: string
  moneda_saldo: 'ARS'
  comision_pct: number
  desde: string
  hasta: string
  dias: DiaBilletera[]
}

const r2n = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
// Día ART (UTC-3 fijo) de un instante → 'YYYY-MM-DD'.
const artDay = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
// Hora ART con offset explícito, sin milisegundos: '2026-07-20T09:06:04-03:00'.
const artHora = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 19) + '-03:00'

const ESTADO: Record<PagoBilletera['estado'], PagoIngreso['estado']> = {
  emparejado: 'emparejado', en_cola: 'pendiente', reembolsado: 'reembolsado',
}

// Lista de días ART entre desde y hasta inclusive. Argentina es UTC-3 fijo, así que
// cada paso de 24 h cae en el mismo horario y el slice da el día.
function rangoDias(desde: string, hasta: string): string[] {
  const out: string[] = []
  const t0 = new Date(`${desde}T00:00:00-03:00`).getTime()
  const t1 = new Date(`${hasta}T00:00:00-03:00`).getTime()
  for (let t = t0; t <= t1; t += 24 * 3600_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export async function getRegistroBilleteraRango(
  wallet: string, desde: string, hasta: string,
): Promise<RegistroBilleteraRango> {
  const desdeMs = new Date(`${desde}T00:00:00-03:00`).getTime()
  const hastaMs = new Date(`${hasta}T00:00:00-03:00`).getTime() + 24 * 3600_000
  const extracto = await getExtractoBilleteraRango(wallet, desdeMs, hastaMs)

  const pagosPorDia = new Map<string, PagoBilletera[]>()
  for (const p of extracto.pagos) {
    const d = artDay(p.fecha)
    const arr = pagosPorDia.get(d)
    if (arr) arr.push(p); else pagosPorDia.set(d, [p])
  }
  const movsPorDia = new Map<string, MovimientoDia[]>()
  for (const m of extracto.movimientos) {
    const d = artDay(m.fecha)
    const arr = movsPorDia.get(d)
    if (arr) arr.push(m); else movsPorDia.set(d, [m])
  }

  const dias: DiaBilletera[] = rangoDias(desde, hasta).map(fecha => {
    const pg = pagosPorDia.get(fecha) ?? []
    const mv = movsPorDia.get(fecha) ?? []

    const ingresosArs = pg.reduce((a, p) => a + p.monto, 0)
    const comisionArs = pg.reduce((a, p) => a + p.comision, 0)
    const retiros = mv.filter(m => m.clase === 'retiro')
    const reembolsos = mv.filter(m => m.clase === 'reembolso')
    const ajustes = mv.filter(m => m.clase === 'ajuste')
    const salidas = retiros.reduce((a, m) => a + m.ars, 0) + reembolsos.reduce((a, m) => a + m.ars, 0)
    const sumaAjustes = ajustes.reduce((a, m) => a + m.ars, 0)

    return {
      fecha,
      ingresos: {
        ars: r2n(ingresosArs),
        cantidad: pg.length,
        pagos: pg.map((p): PagoIngreso => ({
          hora: artHora(p.fecha),
          titular: p.titular || null,
          cuit: p.cuit || null,
          ars: r2n(p.monto),
          comision_ars: r2n(p.comision),
          estado: ESTADO[p.estado],
          tienda: p.tienda ?? null,
          orden: p.orden ?? null,
        })),
      },
      comision: { pct: extracto.comisionPct, ars: r2n(comisionArs) },
      retiros: retiros.map((m): RetiroBilletera => ({
        hora: artHora(m.fecha), concepto: m.concepto, moneda: m.moneda ?? null,
        monto: m.montoOrigen == null ? null : r2n(m.montoOrigen),
        cotizacion: m.cotizacion == null ? null : r2n(m.cotizacion),
        ars: r2n(m.ars),
      })),
      reembolsos: reembolsos.map((m): ReembolsoBilleteraApi => ({
        hora: artHora(m.fecha), concepto: m.concepto, tienda: m.tienda ?? null, ars: r2n(m.ars),
      })),
      // El "ajuste" es el saldo inicial del corte de la billetera, si cae en el rango.
      ajustes: ajustes.map((m): AjusteBilletera => ({ hora: artHora(m.fecha), concepto: m.concepto, ars: r2n(m.ars) })),
      saldo_neto_dia_ars: r2n(ingresosArs - comisionArs - salidas + sumaAjustes),
    }
  })

  return { billetera: wallet, moneda_saldo: 'ARS', comision_pct: extracto.comisionPct, desde, hasta, dias }
}
