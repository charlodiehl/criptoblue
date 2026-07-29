import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveWalletScope, setUnidad } from '@/lib/auth/server'
import { getIngresosBilletera, getBilleterasOcultas, getDiasConMovimiento } from '@/lib/billeteras'
import { puedeEnBilletera } from '@/lib/permisos'

// Sin el permiso 'ver_saldo' los MONTOS no se mandan (van en null) y el front los
// muestra tapados (***). Se hace acá y no en la UI: tapar en el cliente sería
// cosmético, los números seguirían viajando en la respuesta. Las CANTIDADES de
// pagos sí se mandan — no son plata y hacen falta para navegar el extracto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function censurarMontos(detalle: any) {
  return {
    ...detalle,
    totalArs: null, totalDia: null, comisionDia: null, saldoDia: null,
    salidasDiaArs: null, reembolsosDiaArs: null, ajustesDiaArs: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagos: (detalle.pagos ?? []).map((p: any) => ({ ...p, monto: null, comision: null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    movimientosDia: (detalle.movimientosDia ?? []).map((m: any) => ({
      ...m, ars: null, montoOrigen: null, cotizacion: null,
    })),
  }
}

// GET /api/billetera?wallet=<w>[&fecha=YYYY-MM-DD] → total + extracto + días con
// movimiento. La wallet pedida se VALIDA contra los accesos del usuario (multi-acceso):
// solo devuelve datos de una billetera que el usuario tiene asignada — nunca se confía
// en el cliente. Rol 'billetera'.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('billetera')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const scope = resolveWalletScope(auth.user, req.nextUrl.searchParams.get('wallet'))
    if (!scope) return NextResponse.json({ error: 'Billetera no autorizada' }, { status: 403 })
    const wallet = scope.wallet

    const ocultas = await getBilleterasOcultas()
    if (ocultas.includes(wallet)) return NextResponse.json({ error: 'Billetera no disponible' }, { status: 404 })

    const fecha = req.nextUrl.searchParams.get('fecha') || undefined
    const [detalle, dias] = await Promise.all([
      getIngresosBilletera(wallet, fecha),
      getDiasConMovimiento(wallet),
    ])
    const verSaldo = puedeEnBilletera({ role: auth.user.role, permisos: scope.permisos }, 'ver_saldo')
    return NextResponse.json({ ...(verSaldo ? detalle : censurarMontos(detalle)), dias, verSaldo })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
