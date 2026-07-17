// ─────────────────────────────────────────────────────────────────────────────
// Permisos por integrante DENTRO de una tienda. Son SIEMPRE relativos a la tienda
// del usuario (app_users.store_id): un usuario de una tienda nunca ve ni edita a los
// de otra. La lista de permisos es FIJA — esta es la única fuente, y el backend solo
// acepta estas claves (whitelist).
//
// No confundir con app_users.role: 'admin' es el SUPER-ADMIN del sistema (opera todas
// las tiendas y puede todo); 'tienda' es un integrante, cuyas capacidades salen de acá.
// ─────────────────────────────────────────────────────────────────────────────

export type PermisoKey =
  | 'administracion'
  | 'solicitar_transferencias'
  | 'solicitar_reembolsos'

export interface Permiso {
  key: PermisoKey
  label: string
  descripcion: string
}

export const PERMISOS: Permiso[] = [
  {
    key: 'administracion',
    label: 'Administración',
    descripcion: 'Puede dar y quitar permisos a los demás integrantes de la tienda.',
  },
  {
    key: 'solicitar_transferencias',
    label: 'Solicitar transferencias',
    descripcion: 'Puede entrar y operar la pestaña de solicitar transferencias.',
  },
  {
    key: 'solicitar_reembolsos',
    label: 'Solicitar reembolsos',
    descripcion: 'Puede entrar y operar la pestaña de solicitar reembolsos.',
  },
]

export const PERMISO_KEYS: readonly PermisoKey[] = PERMISOS.map(p => p.key)

// Mapa { clave: boolean }. Ausencia de clave = permiso NO otorgado (false).
export type Permisos = Partial<Record<PermisoKey, boolean>>

// Deja solo las claves válidas y valores booleanos: nunca se guarda lo que mande el
// cliente sin filtrar (evita permisos inventados o basura en la columna JSONB).
export function sanearPermisos(entrada: unknown): Permisos {
  const out: Permisos = {}
  if (entrada && typeof entrada === 'object') {
    for (const k of PERMISO_KEYS) {
      const v = (entrada as Record<string, unknown>)[k]
      if (typeof v === 'boolean') out[k] = v
    }
  }
  return out
}

// ── Decisiones de autorización (puras; las usan el front para el gating visual y el
//    backend para el gating REAL). El super-admin del sistema (role 'admin') puede todo.
export interface UsuarioConPermisos {
  role: 'admin' | 'tienda'
  permisos?: Permisos | null
}

export function puede(user: UsuarioConPermisos, key: PermisoKey): boolean {
  if (user.role === 'admin') return true
  return user.permisos?.[key] === true
}

// Puede gestionar el equipo (dar/quitar permisos, agregar miembros) de SU tienda.
export function puedeGestionarEquipo(user: UsuarioConPermisos): boolean {
  return puede(user, 'administracion')
}
