import { NextRequest, NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'
import { buscarEmparejadosPorMonto } from '@/lib/registro'
import { billeteraLabel } from '@/lib/utils'
import type { Payment } from '@/lib/types'

// Ventana de fecha alrededor del comprobante. Amplia (±24h) porque la fecha del pago
// en la app viene del medio (no del segundo exacto del comprobante); el monto exacto
// ya acota lo suficiente.
const VENTANA_MS = 24 * 60 * 60 * 1000

// POST { monto: number, fechaISO: string }
// Busca EN LOS PAGOS DE LA APP (cola + emparejados), NO en MercadoPago, por monto
// exacto y fecha dentro de ±24h. Marca cada resultado con enCola / yaEmparejado, para
// que el admin lo empareje y para bloquear reusar uno ya emparejado (impedir que un
// mismo pago valide más de una orden).
export async function POST(req: NextRequest) {
  try {
    const { monto, fechaISO } = await req.json()

    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }
    const fechaMs = fechaISO ? new Date(fechaISO).getTime() : NaN
    if (!Number.isFinite(fechaMs)) {
      return NextResponse.json({ error: 'Fecha/hora inválida' }, { status: 400 })
    }

    const enVentana = (f: string) => {
      const t = f ? new Date(f).getTime() : NaN
      return Number.isFinite(t) && Math.abs(t - fechaMs) <= VENTANA_MS
    }

    const hot = await loadHotState()

    // 1) En cola (sin emparejar) → disponibles para emparejar.
    const enCola = (hot.unmatchedPayments ?? [])
      .map(u => u.payment)
      .filter((p): p is Payment => !!p && p.monto === montoNum && enVentana(p.fechaPago || ''))
    const idsCola = new Set(enCola.map(p => p.mpPaymentId).filter(Boolean))

    // 2) Ya emparejados → se muestran bloqueados (no se pueden reusar).
    const emparejados = (await buscarEmparejadosPorMonto(montoNum))
      .filter(e => e.monto === montoNum && enVentana(e.fechaPago) && (!e.mpPaymentId || !idsCola.has(e.mpPaymentId)))

    const resultados = [
      ...enCola.map(p => ({ payment: p, enCola: true, yaEmparejado: false })),
      ...emparejados.map(e => ({
        payment: {
          mpPaymentId: e.mpPaymentId || '',
          monto: e.monto,
          nombrePagador: e.nombrePagador,
          emailPagador: '',
          cuitPagador: '',
          referencia: '',
          operationId: '',
          metodoPago: billeteraLabel(e.source),
          fechaPago: e.fechaPago,
          status: 'approved',
          source: e.source,
          rawData: {},
        } as Payment,
        enCola: false,
        yaEmparejado: true,
      })),
    ]

    return NextResponse.json({ resultados, total: resultados.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
