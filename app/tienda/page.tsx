import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/server'
import TiendaPortal from '@/components/tienda/TiendaPortal'

// Portal de la tienda. El middleware ya garantizó sesión + rol + 2FA. Acá solo
// resolvemos la identidad de la tienda del usuario. Un admin que caiga en /tienda
// se manda a la app principal (los admins operan la vista espejo desde /finanzas).
export default async function TiendaPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'tienda' || !user.storeId) redirect('/')

  return (
    <TiendaPortal
      storeId={user.storeId}
      userEmail={user.email}
    />
  )
}
