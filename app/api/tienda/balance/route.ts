import { NextRequest, NextResponse } from 'next/server'
import { requireUser, resolveStoreScope } from '@/lib/auth/server'
import { getBalance, getBalanceDia, getDiasConMovimiento } from '@/lib/balance'

// GET /api/tienda/balance[?storeId=][&fecha=YYYY-MM-DD]
//   → { ars, usdt, pendientes, comision…, dias[] } y, si viene fecha, { dia: {…} }
// `dias` son los días con movimiento: el calendario deshabilita el resto.
// storeId: rol tienda usa el suyo (ignora el query); admin lo pasa explícito.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const storeId = resolveStoreScope(auth.user, req.nextUrl.searchParams.get('storeId'))
    if (!storeId) return NextResponse.json({ error: 'No hay tienda asignada' }, { status: 400 })

    const fecha = req.nextUrl.searchParams.get('fecha')
    const diaValido = !!fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)

    const [balance, dia, dias] = await Promise.all([
      getBalance(storeId),
      diaValido ? getBalanceDia(storeId, fecha!) : Promise.resolve(null),
      getDiasConMovimiento(storeId),
    ])

    return NextResponse.json({ ...balance, dias, ...(dia ? { dia } : {}) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
