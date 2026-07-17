import { getClient } from './storage'
import { sanearPermisos, type Permisos } from './permisos'

// ─────────────────────────────────────────────────────────────────────────────
// Gestión del equipo de UNA tienda (integrantes de app_users con role='tienda' y el
// mismo store_id). La AUTORIZACIÓN (quién puede hacer qué) se decide en el endpoint;
// acá las queries llevan SIEMPRE el store_id como candado extra (defensa en
// profundidad: aunque el endpoint fallara, nunca se toca a alguien de otra tienda).
// ─────────────────────────────────────────────────────────────────────────────

export interface MiembroEquipo {
  email: string
  displayName: string | null
  permisos: Permisos
}

// Integrantes de una tienda. NUNCA se listan usuarios de otra tienda ni los admin
// del sistema (que no pertenecen a ninguna).
export async function listarEquipo(storeId: string): Promise<MiembroEquipo[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email, display_name, permisos')
    .eq('role', 'tienda').eq('store_id', storeId)
    .order('email')
  if (error) throw new Error(`listarEquipo falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => ({
    email: String(r.email), displayName: r.display_name ?? null, permisos: sanearPermisos(r.permisos),
  }))
}

// Un usuario cualquiera (para validar tienda/rol del objetivo antes de operar). null si no existe.
export async function getUsuario(email: string): Promise<{ email: string; role: 'admin' | 'tienda'; storeId: string | null; permisos: Permisos } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email, role, store_id, permisos').eq('email', email.toLowerCase()).maybeSingle()
  if (error) throw new Error(`getUsuario falló: ${error.message} [${error.code}]`)
  if (!data) return null
  return { email: String(data.email), role: data.role, storeId: data.store_id ?? null, permisos: sanearPermisos(data.permisos) }
}

// Actualiza los permisos de un integrante. El WHERE lleva email + store_id + role:
// si el objetivo no es de esa tienda, no toca ninguna fila (0 afectadas → error).
export async function setPermisos(email: string, storeId: string, permisos: Permisos): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .update({ permisos }).eq('email', email.toLowerCase()).eq('store_id', storeId).eq('role', 'tienda')
    .select('email')
  if (error) throw new Error(`setPermisos falló: ${error.message} [${error.code}]`)
  if (!data || !data.length) throw new Error('El integrante no pertenece a esta tienda')
}

// Alta de un integrante en una tienda. store_id lo pone el server (nunca el cliente).
export async function agregarMiembro(email: string, storeId: string, displayName: string, permisos: Permisos): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getClient().from('app_users') as any).insert({
    email: email.toLowerCase(), role: 'tienda', store_id: storeId, display_name: displayName, permisos,
  })
  if (error) throw new Error(`agregarMiembro falló: ${error.message} [${error.code}]`)
}
