import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/server'
import { getStores } from '@/lib/storage'
import TiendaPortal from '@/components/tienda/TiendaPortal'

// Portal de la tienda. El middleware ya garantizó sesión + rol + 2FA. Acá solo
// resolvemos la identidad de la tienda del usuario. Un admin que caiga en /tienda
// se manda a la app principal (los admins operan la vista espejo desde /finanzas).
export default async function TiendaPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'tienda' || !user.storeId) redirect('/')

  const stores = await getStores()
  const store = stores[user.storeId]

  return (
    <TiendaPortal
      storeId={user.storeId}
      storeName={store?.storeName ?? 'Mi tienda'}
      userEmail={user.email}
    />
  )
}
