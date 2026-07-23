import { redirect } from 'next/navigation'
import { getSessionUser, setUnidad } from '@/lib/auth/server'
import { buildAccesoItems } from '@/lib/multi-acceso'
import BilleteraPortal from '@/components/billetera/BilleteraPortal'
import MultiAccesoApp from '@/components/MultiAccesoApp'

// Portal del dueño de una billetera. El middleware ya garantizó sesión + rol + 2FA.
//  - 0 accesos (admin): a su casa.
//  - más de 1: menú lateral (multi-acceso).
//  - exactamente 1: el portal simple de siempre (si su único acceso es tienda, a /tienda).
export default async function BilleteraPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  // La unidad de negocio se aplica ACÁ, en el frame de la página (ver lib/unidad.ts).
  setUnidad(user.unidad)
  if (user.accesos.length === 0) redirect('/')

  if (user.accesos.length > 1) {
    const items = await buildAccesoItems(user)
    return <MultiAccesoApp items={items} userEmail={user.email} />
  }

  const acceso = user.accesos[0]
  if (acceso.tipo === 'tienda') redirect('/tienda')

  return (
    <BilleteraPortal
      wallet={acceso.id}
      permiso={acceso.billeteraPermiso}
      userEmail={user.email}
    />
  )
}
