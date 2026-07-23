import { redirect } from 'next/navigation'
import { getSessionUser, setUnidad } from '@/lib/auth/server'
import FinanzasApp from '@/components/finanzas/FinanzasApp'

// Administración Financiera — solo admin (el middleware ya lo garantiza; doble
// chequeo defensivo). Los datos (tiendas, balances, solicitudes) los trae el
// cliente vía /api/finanzas/*.
export default async function FinanzasPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  // La unidad de negocio se aplica ACÁ, en el frame de la página (ver lib/unidad.ts).
  setUnidad(user.unidad)
  if (user.role !== 'admin') redirect('/tienda')

  return <FinanzasApp userEmail={user.email} />
}
