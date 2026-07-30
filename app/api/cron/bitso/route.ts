import { NextResponse } from 'next/server'
import { getDepositos } from '@/lib/bitso'
import { registrarPagoSoloBilletera } from '@/lib/registro'
import { loadLogs, saveLogs, appendError, appendActivity } from '@/lib/storage'
import { runEnUnidad, cutoffPagos } from '@/lib/unidad'
import { BITSO_DESDE } from '@/lib/config'
import type { Payment } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Cron: trae los depósitos de Bitso por API y los asienta en la billetera
// "Bitso FluoGames" (unidad MS).
//
// Reemplaza al circuito por email (Apps Script → webhook), que se borró. Ventajas,
// todas verificadas contra la API real:
//   • el id del pago es el `fid` de Bitso, no el del mail → imposible duplicar
//   • trae el CUIT del pagador, que el aviso por mail no incluía
//   • si una corrida falla, la siguiente recupera lo que falte: se consulta un
//     rango, no un evento suelto. Con el email, un aviso perdido se perdía.
//   • no depende de Gmail ni de su cuota
//
// Es idempotente: registrarPagoSoloBilletera() no reasienta un pago ya cargado, así
// que correrlo de más no duplica. Por eso puede consultar una ventana amplia.
//
// Auth: CRON_SECRET (lo valida el middleware — ver CRON_ROUTES en proxy.ts).
// ─────────────────────────────────────────────────────────────────────────────

// La consulta a Bitso puede paginar varias veces; el techo por defecto es corto.
export const maxDuration = 60

const UNIDAD = 'ms'

async function run() {
  try {
    return await runEnUnidad(UNIDAD, async () => {
      // Piso: el más TARDÍO entre el corte de la unidad y el de esta integración.
      // Sin esto, un rearme del cron traería el histórico entero de la cuenta.
      const piso = new Date(Math.max(BITSO_DESDE.getTime(), cutoffPagos().getTime()))

      let depositos
      try {
        depositos = await getDepositos(piso)
      } catch (err) {
        // Falla de la API o de credenciales: se avisa y se corta. La próxima corrida
        // reintenta el mismo rango, así que no se pierde ningún depósito.
        const logs = await loadLogs()
        appendError(logs, 'bitso', 'error',
          `No se pudieron traer los depósitos de Bitso: ${String(err)}. Se reintenta en la próxima corrida.`)
        await saveLogs(logs)
        return NextResponse.json({ error: String(err) }, { status: 502 })
      }

      let cargados = 0, yaEstaban = 0, ignorados = 0
      const nuevos: { monto: number; titular: string }[] = []

      for (const d of depositos) {
        // Solo acreditaciones confirmadas.
        if (d.status !== 'complete') { ignorados++; continue }
        // La billetera opera en pesos: un depósito en otra moneda NO se carga como si
        // fueran ARS. Se avisa para resolverlo a mano.
        if (String(d.currency).toLowerCase() !== 'ars') {
          ignorados++
          const logs = await loadLogs()
          appendError(logs, 'bitso', 'warning',
            `Depósito de Bitso en ${String(d.currency).toUpperCase()} (${d.amount}) — NO se cargó: la billetera opera en ARS.`,
            { fid: d.fid })
          await saveLogs(logs)
          continue
        }
        const monto = Number(d.amount)
        if (!Number.isFinite(monto) || monto <= 0) { ignorados++; continue }

        const payment: Payment = {
          mpPaymentId: `bitso-${d.fid}`,     // el fid es el id real de la operación
          monto,
          nombrePagador: d.details?.sender_name ?? '',
          emailPagador: '',
          cuitPagador: d.details?.sender_cuitcuil ?? '',
          referencia: d.details?.sender_address ?? '',   // CBU/CVU de origen
          operationId: d.fid,
          metodoPago: `Bitso / ${d.method_name || 'transferencia'}`,
          fechaPago: new Date(d.created_at).toISOString(),
          status: 'approved',
          source: 'bitso',
          rawData: {
            fid: d.fid,
            esquema: d.details?.sender_scheme ?? '',
            banco: d.details?.sender_bank ?? '',
          },
        }

        if (await registrarPagoSoloBilletera(payment)) {
          cargados++
          nuevos.push({ monto, titular: payment.nombrePagador })
        } else {
          yaEstaban++
        }
      }

      if (cargados > 0) {
        try {
          const logs = await loadLogs()
          for (const n of nuevos) appendActivity(logs, 'system', 'bitso_pago_recibido', n)
          await saveLogs(logs)
        } catch { /* los pagos ya quedaron asentados: el log no puede romperlo */ }
      }

      return NextResponse.json({
        success: true,
        desde: piso.toISOString(),
        consultados: depositos.length,
        cargados, yaEstaban, ignorados,
      })
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() { return run() }
export async function POST() { return run() }
