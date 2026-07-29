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
  | 'ver_saldo'
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
    key: 'ver_saldo',
    label: 'Ver saldo',
    descripcion: 'Ve los montos del saldo total y del día. Sin este permiso los ve tapados (***).',
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

// ─────────────────────────────────────────────────────────────────────────────
// Permisos por integrante DENTRO de una BILLETERA. Mismo modelo que los de tienda
// (lista fija, whitelist, 'administracion' implica todo), pero con sus propias
// capacidades: una billetera no pide transferencias ni reembolsos, anota retiros.
//
// 'administracion' y 'ver_saldo' se llaman IGUAL que en tienda a propósito: son la
// misma idea, y que se llamen distinto en cada pantalla es justo lo que confunde.
//
// Reemplazan al par editor/lectura, que era binario y no permitía —por ejemplo—
// alguien que anote retiros pero no vea el saldo total.
// ─────────────────────────────────────────────────────────────────────────────

export type PermisoBilleteraKey =
  | 'administracion'
  | 'registrar_retiros'
  | 'ver_saldo'

export const PERMISOS_BILLETERA: { key: PermisoBilleteraKey; label: string; descripcion: string }[] = [
  {
    key: 'administracion',
    label: 'Administración',
    descripcion: 'Puede dar y quitar permisos a los demás integrantes de la billetera.',
  },
  {
    key: 'registrar_retiros',
    label: 'Anotar retiros de saldo',
    descripcion: 'Puede entrar y operar la pestaña de retirar saldo.',
  },
  {
    key: 'ver_saldo',
    label: 'Ver saldo',
    descripcion: 'Ve los montos del saldo y del extracto. Sin este permiso los ve tapados (***).',
  },
]

export const PERMISO_BILLETERA_KEYS: readonly PermisoBilleteraKey[] = PERMISOS_BILLETERA.map(p => p.key)

export type PermisosBilletera = Partial<Record<PermisoBilleteraKey, boolean>>

export function sanearPermisosBilletera(entrada: unknown): PermisosBilletera {
  const out: PermisosBilletera = {}
  if (entrada && typeof entrada === 'object') {
    for (const k of PERMISO_BILLETERA_KEYS) {
      const v = (entrada as Record<string, unknown>)[k]
      if (typeof v === 'boolean') out[k] = v
    }
  }
  return out
}

// Decisión de autorización sobre una billetera. El super-admin del sistema puede
// todo; dentro de la billetera, 'administracion' también.
export function puedeEnBilletera(
  user: { role: 'admin' | 'tienda' | 'billetera'; permisos?: PermisosBilletera | null },
  key: PermisoBilleteraKey,
): boolean {
  if (user.role === 'admin') return true
  if (user.permisos?.administracion === true) return true
  return user.permisos?.[key] === true
}

export function puedeGestionarEquipoBilletera(
  user: { role: 'admin' | 'tienda' | 'billetera'; permisos?: PermisosBilletera | null },
): boolean {
  return user.role === 'admin' || user.permisos?.administracion === true
}

// Traduce el modelo viejo (editor | lectura) al nuevo. Se usa en el backfill y como
// respaldo para una fila que todavía no tenga los permisos nuevos.
//   editor  → anota retiros y ve el saldo
//   lectura → solo ve el saldo
export function permisosDesdeEditorLectura(permiso: 'editor' | 'lectura' | null | undefined): PermisosBilletera {
  return permiso === 'editor'
    ? { registrar_retiros: true, ver_saldo: true }
    : { ver_saldo: true }
}

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
  role: 'admin' | 'tienda' | 'billetera'   // 'billetera' no tiene permisos de tienda → puede() = false
  permisos?: Permisos | null
}

export function puede(user: UsuarioConPermisos, key: PermisoKey): boolean {
  if (user.role === 'admin') return true                    // super-admin del sistema
  if (user.permisos?.administracion === true) return true   // Administrador de tienda: TODOS los permisos
  return user.permisos?.[key] === true
}

// Puede gestionar el equipo (dar/quitar permisos, agregar miembros) de SU tienda.
// Es el Administrador de tienda (o el super-admin).
export function puedeGestionarEquipo(user: UsuarioConPermisos): boolean {
  return user.role === 'admin' || user.permisos?.administracion === true
}
