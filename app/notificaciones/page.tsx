import { redirect } from 'next/navigation'
import { getSessionUser, setUnidad } from '@/lib/auth/server'
import NotificacionesPanel from '@/components/pwa/NotificacionesPanel'

// Página de Notificaciones (admin y tienda). Toggle global (suscripción del
// dispositivo) + activar/desactivar cada grupo por separado. Los grupos que se
// muestran dependen del rol (los admins reciben otros eventos que las tiendas).
export default async function NotificacionesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  // La unidad de negocio se aplica ACÁ, en el frame de la página (ver lib/unidad.ts).
  setUnidad(user.unidad)

  return <NotificacionesPanel userEmail={user.email} role={user.role} />
}
