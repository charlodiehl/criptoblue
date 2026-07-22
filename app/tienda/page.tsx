import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/server'
import { buildAccesoItems } from '@/lib/multi-acceso'
import TiendaPortal from '@/components/tienda/TiendaPortal'
import MultiAccesoApp from '@/components/MultiAccesoApp'

// Portal de la tienda. El middleware ya garantizó sesión + rol + 2FA. Acá resolvemos
// los accesos del usuario:
//  - 0 accesos (admin): a la app principal (los admin operan la vista espejo en /finanzas).
//  - más de 1: menú lateral (multi-acceso) para elegir tienda/billetera.
//  - exactamente 1: el portal simple de siempre (si su único acceso es billetera, a /billetera).
export default async function TiendaPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.accesos.length === 0) redirect('/')

  if (user.accesos.length > 1) {
    const items = await buildAccesoItems(user)
    return <MultiAccesoApp items={items} userEmail={user.email} />
  }

  const acceso = user.accesos[0]
  if (acceso.tipo === 'billetera') redirect('/billetera')

  return (
    <TiendaPortal
      storeId={acceso.id}
      userEmail={user.email}
      permisos={acceso.permisos}
    />
  )
}
