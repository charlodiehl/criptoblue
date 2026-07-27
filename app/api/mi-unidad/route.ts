import { NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { unidadActiva } from '@/lib/unidad'

// GET /api/mi-unidad → la unidad de negocio de la sesión.
//
// El front la necesita para dos cosas que NO puede resolver solo: mostrar de qué
// negocio es el panel, y saber qué billeteras existen (las listas de billeteras
// son por unidad — una unidad sin billeteras conectadas muestra los selectores
// vacíos, en vez de ofrecer las de la otra).
export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
  setUnidad(auth.user.unidad)

  const u = unidadActiva()
  return NextResponse.json({
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    wallets: u.wallets,
    // Cortes de la unidad: el cliente filtra con ellos lo que muestra. La fuente de
    // verdad es el servidor (que además no trae nada anterior); esto es para que la
    // vista no muestre algo que el backend ya considera fuera de la unidad.
    cutoffs: {
      pagos: u.cutoffs.pagos.toISOString(),
      ordenes: u.cutoffs.ordenes.toISOString(),
      balance: u.cutoffs.balance.toISOString(),
    },
  })
}
