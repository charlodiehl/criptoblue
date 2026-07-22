import { getStores } from '@/lib/storage'
import type { SessionUser } from '@/lib/auth/server'
import type { AccesoUI } from '@/components/MultiAccesoApp'

// Resuelve los accesos del usuario a ítems listos para el menú lateral. Solo pide los
// nombres de tienda si hace falta (un usuario de solo billeteras no toca getStores).
export async function buildAccesoItems(user: SessionUser): Promise<AccesoUI[]> {
  const necesitaNombres = user.accesos.some(a => a.tipo === 'tienda')
  const stores = necesitaNombres ? await getStores() : {}
  return user.accesos.map((a): AccesoUI =>
    a.tipo === 'tienda'
      ? { tipo: 'tienda', id: a.id, label: stores[a.id]?.storeName ?? `Tienda ${a.id}`, permisos: a.permisos }
      : { tipo: 'billetera', id: a.id, label: a.id, permiso: a.billeteraPermiso },
  )
}
