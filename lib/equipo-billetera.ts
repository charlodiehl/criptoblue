import { getClient } from './storage'
import { sanearPermisosBilletera, permisosDesdeEditorLectura, type PermisosBilletera } from './permisos'

// ─────────────────────────────────────────────────────────────────────────────
// Gestión del equipo de UNA billetera (integrantes de app_users con role='billetera'
// y la misma wallet). Espejo de lib/equipo.ts, que hace lo mismo para tiendas.
//
// La AUTORIZACIÓN (quién puede hacer qué) se decide en el endpoint; acá las queries
// llevan SIEMPRE la wallet como candado extra (defensa en profundidad: aunque el
// endpoint fallara, nunca se toca a alguien de otra billetera).
// ─────────────────────────────────────────────────────────────────────────────

export interface MiembroBilletera {
  email: string
  displayName: string | null
  permisos: PermisosBilletera
}

// Una fila puede no tener todavía los permisos nuevos (deploy en curso o alta vieja):
// en ese caso se derivan del par editor/lectura, así nadie aparece sin permisos.
function permisosDeFila(row: { billetera_permisos?: unknown; billetera_permiso?: 'editor' | 'lectura' | null }): PermisosBilletera {
  const p = sanearPermisosBilletera(row.billetera_permisos)
  return Object.keys(p).length ? p : permisosDesdeEditorLectura(row.billetera_permiso)
}

// Integrantes de una billetera. NUNCA se listan los de otra ni los admin del sistema.
export async function listarEquipoBilletera(wallet: string): Promise<MiembroBilletera[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email, display_name, billetera_permisos, billetera_permiso')
    .eq('role', 'billetera').eq('wallet', wallet)
    .order('email')
  if (error) throw new Error(`listarEquipoBilletera falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => ({
    email: String(r.email), displayName: r.display_name ?? null, permisos: permisosDeFila(r),
  }))
}

// Un usuario cualquiera (para validar billetera/rol del objetivo antes de operar).
export async function getUsuarioBilletera(email: string): Promise<{ email: string; role: 'admin' | 'tienda' | 'billetera'; wallet: string | null; permisos: PermisosBilletera } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email, role, wallet, billetera_permisos, billetera_permiso').eq('email', email.toLowerCase()).maybeSingle()
  if (error) throw new Error(`getUsuarioBilletera falló: ${error.message} [${error.code}]`)
  if (!data) return null
  return { email: String(data.email), role: data.role, wallet: data.wallet ?? null, permisos: permisosDeFila(data) }
}

// Actualiza los permisos de un integrante. El WHERE lleva email + wallet + role:
// si el objetivo no es de esa billetera, no toca ninguna fila (0 afectadas → error).
export async function setPermisosBilletera(email: string, wallet: string, permisos: PermisosBilletera): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .update({
      billetera_permisos: permisos,
      // Se mantiene el campo viejo en sync mientras exista: si hubiera que volver
      // atrás el deploy, el permiso sigue siendo el correcto.
      billetera_permiso: permisos.administracion || permisos.registrar_retiros ? 'editor' : 'lectura',
    })
    .eq('email', email.toLowerCase()).eq('wallet', wallet).eq('role', 'billetera')
    .select('email')
  if (error) throw new Error(`setPermisosBilletera falló: ${error.message} [${error.code}]`)
  if (!data || !data.length) throw new Error('El integrante no pertenece a esta billetera')
}

// Alta de un integrante en una billetera. La wallet la pone el server (nunca el cliente).
export async function agregarMiembroBilletera(email: string, wallet: string, displayName: string, permisos: PermisosBilletera): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getClient().from('app_users') as any).insert({
    email: email.toLowerCase(), role: 'billetera', wallet, display_name: displayName,
    billetera_permisos: permisos,
    billetera_permiso: permisos.administracion || permisos.registrar_retiros ? 'editor' : 'lectura',
  })
  if (error) throw new Error(`agregarMiembroBilletera falló: ${error.message} [${error.code}]`)
}

// Da de baja a un integrante. El WHERE lleva email + wallet + role='billetera'
// (candado: nunca toca a alguien de otra billetera ni a un admin del sistema).
export async function eliminarMiembroBilletera(email: string, wallet: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .delete().eq('email', email.toLowerCase()).eq('wallet', wallet).eq('role', 'billetera')
    .select('email')
  if (error) throw new Error(`eliminarMiembroBilletera falló: ${error.message} [${error.code}]`)
  return (data?.length ?? 0) > 0
}
