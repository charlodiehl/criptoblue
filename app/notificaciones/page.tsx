import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/server'
import NotificacionesPanel from '@/components/pwa/NotificacionesPanel'

// Página de Notificaciones — solo administradores. Toggle global (suscripción del
// dispositivo) + activar/desactivar cada grupo de notificaciones por separado.
export default async function NotificacionesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/tienda')

  return <NotificacionesPanel userEmail={user.email} />
}
