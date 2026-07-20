import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/server'
import BilleteraPortal from '@/components/billetera/BilleteraPortal'

// Portal del dueño de una billetera. El middleware ya garantizó sesión + rol + 2FA.
// Un admin/tienda que caiga acá se manda a su casa.
export default async function BilleteraPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'billetera' || !user.wallet) redirect('/')

  return (
    <BilleteraPortal
      wallet={user.wallet}
      permiso={user.billeteraPermiso === 'editor' ? 'editor' : 'lectura'}
      userEmail={user.email}
    />
  )
}
