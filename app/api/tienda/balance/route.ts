import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope, scopedUser, setUnidad } from '@/lib/auth/server'
import { getBalance, getBalanceDia, getDiasConMovimiento } from '@/lib/balance'
import { puede } from '@/lib/permisos'
import { tiendaLlevaSaldoEnPesos } from '@/lib/config'

// Montos que solo ve quien tiene el permiso 'ver_saldo'. Se ponen en null ACÁ, en el
// servidor: si solo se taparan en la UI, cualquiera los leería en la pestaña de red.
// Los conteos (pendientes, cantidadIngresos) y el % de comisión NO son montos y se
// mandan igual: la UI los necesita para los textos y no revelan el saldo.
function taparMontos(balance: Record<string, unknown>) {
  const MONTOS = ['ars', 'usdt', 'comisionArs', 'comisionUsdt']
  // Van los de las DOS monedas: una tienda con saldo en pesos muestra las líneas en ARS
  // (ver TIENDAS_SALDO_EN_PESOS), así que taparle solo las de USDT no taparía nada.
  const MONTOS_DIA = ['saldoUsdt', 'ingresosUsdt', 'ingresoManualUsdt', 'comisionUsdt',
    'transferenciasUsdt', 'reembolsosUsdt', 'ajustesUsdt',
    'saldoArs', 'ingresosArs', 'ingresoManualArs', 'comisionArs',
    'transferenciasArs', 'reembolsosArs', 'ajustesArs']
  const out = { ...balance }
  for (const k of MONTOS) if (k in out) out[k] = null
  if (out.dia && typeof out.dia === 'object') {
    const dia = { ...(out.dia as Record<string, unknown>) }
    for (const k of MONTOS_DIA) if (k in dia) dia[k] = null
    out.dia = dia
  }
  return out
}

// GET /api/tienda/balance[?storeId=][&fecha=YYYY-MM-DD]
//   → { ars, usdt, pendientes, comision…, dias[] } y, si viene fecha, { dia: {…} }
// `dias` son los días con movimiento: el calendario deshabilita el resto.
// storeId: rol tienda usa el suyo (ignora el query); admin lo pasa explícito.
// verSaldo=false → los montos vienen en null y la UI los muestra tapados (***).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const fecha = req.nextUrl.searchParams.get('fecha')
    const diaValido = !!fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)

    const [balance, dia, dias] = await Promise.all([
      getBalance(storeId),
      diaValido ? getBalanceDia(storeId, fecha!) : Promise.resolve(null),
      getDiasConMovimiento(storeId),
    ])

    // Permiso 'ver_saldo' DE ESA tienda (puede ser un acceso secundario). El
    // super-admin y el Administrador de tienda pueden por su rol (ver lib/permisos).
    const verSaldo = puede(scopedUser(auth.user, storeId), 'ver_saldo')
    // Moneda en la que esta tienda lleva su saldo: la UI muestra las tarjetas y el
    // desglose del día en ARS o en USDT según esto (ver TIENDAS_SALDO_EN_PESOS).
    const payload = { ...balance, dias, saldoEnPesos: tiendaLlevaSaldoEnPesos(storeId), ...(dia ? { dia } : {}) }

    return NextResponse.json(verSaldo ? { ...payload, verSaldo } : { ...taparMontos(payload), verSaldo })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
