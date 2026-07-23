import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
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

  const u = unidadActiva()
  return NextResponse.json({
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    wallets: u.wallets,
  })
}
