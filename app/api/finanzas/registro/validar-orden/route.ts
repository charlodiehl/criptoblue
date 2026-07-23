import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import { buscarOrdenEnTienda } from '@/lib/buscar-orden'
import { buscarEntradasPorOrden, baseOrden } from '@/lib/registro'

// GET /api/finanzas/registro/validar-orden?storeId=&orderNumber=[&registroId=]
//
// Chequea un número de orden ANTES de guardarlo. Nada de esto bloquea, salvo el
// duplicado exacto: son avisos para que el admin decida.
//
//   existe / paymentStatus / orderStatus → la orden en la tienda real
//   duplicadoExacto → otra entrada del registro ya usa ESE MISMO número → bloquea
//   similares       → otra entrada usa la misma orden con otro sufijo, p.ej.
//                     "77349 (1)" cuando se escribe "77349". Es un pago parcial
//                     legítimo: solo se avisa.
//
// El sufijo "(n)" marca un pago que vino en dos partes; sirve para no repetir el
// número en el registro, pero en la tienda NO existe "77349 (1)": existe "77349".
// Por eso se consulta la tienda con el número base.
//
// Admin-only: es la puerta de entrada a la edición del registro.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const p = req.nextUrl.searchParams
    const storeId = (p.get('storeId') || '').trim()
    const orderNumber = (p.get('orderNumber') || '').trim()
    const registroIdRaw = p.get('registroId')
    const registroId = registroIdRaw ? Number(registroIdRaw) : undefined

    if (!storeId || !orderNumber) {
      return NextResponse.json({ error: 'storeId y orderNumber son requeridos' }, { status: 400 })
    }

    const store = (await getStores())[storeId]
    if (!store) return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })

    // En la tienda existe "77349", no "77349 (1)": se consulta el número base.
    const base = baseOrden(orderNumber)
    const esPagoParcial = base !== orderNumber

    // La tienda puede fallar (token vencido, API caída): eso no debe tumbar la
    // validación de duplicados, que es la que bloquea. Se reporta aparte.
    let encontrada = null
    let errorTienda: string | null = null
    try {
      encontrada = await buscarOrdenEnTienda(store, base)
    } catch (err) {
      errorTienda = err instanceof Error ? err.message : String(err)
    }

    const { exactas, similares } = await buscarEntradasPorOrden(storeId, store.storeName, orderNumber, registroId)

    return NextResponse.json({
      ordenConsultada: base,
      esPagoParcial,
      existe: !!encontrada,
      errorTienda,
      paymentStatus: encontrada?.paymentStatus ?? null,
      orderStatus: encontrada?.orderStatus ?? null,
      cliente: encontrada?.order.customerName ?? null,
      total: encontrada?.order.total ?? null,
      duplicadoExacto: exactas[0] ?? null,
      similares,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
