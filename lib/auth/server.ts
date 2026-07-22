import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AppUser } from '@/lib/types'
import { sanearPermisos, type Permisos } from '@/lib/permisos'

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación server-side (rutas API y route handlers).
//
// Dos clientes distintos:
//  - createSupabaseServer(): sesión del usuario (cookies) con anon key.
//  - serviceClient(): service key para consultar app_users / admin API.
//
// El middleware (proxy.ts) filtra por rol usando el claim del JWT
// (app_metadata.cb_role, seteado por /auth/callback). Las rutas API
// re-verifican SIEMPRE contra la tabla app_users vía requireUser():
// defensa en profundidad + revocación inmediata (sacar la fila corta el acceso
// en la próxima request de API, sin esperar a que expire el JWT).
// ─────────────────────────────────────────────────────────────────────────────

export async function createSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Llamado desde un Server Component (no puede setear cookies):
            // el middleware ya refresca la sesión, se puede ignorar.
          }
        },
      },
    },
  )
}

let _svc: SupabaseClient | null = null
export function serviceClient(): SupabaseClient {
  if (!_svc) {
    _svc = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _svc
}

// ─── Multi-acceso ─────────────────────────────────────────────────────────────
// Un mismo usuario (email) puede tener acceso a varias tiendas y/o billeteras. El
// acceso PRIMARIO vive en las columnas de siempre (role + store_id o wallet); los
// EXTRA en app_users.accesos_extra (JSONB). getSessionUser unifica todo en `accesos`.
export interface AccesoTienda {
  tipo: 'tienda'
  id: string                                             // storeId
  permisos: Permisos                                     // permisos DE ESA tienda
}
export interface AccesoBilletera {
  tipo: 'billetera'
  id: string                                             // wallet
  billeteraPermiso: 'editor' | 'lectura'
}
export type Acceso = AccesoTienda | AccesoBilletera

export interface SessionUser {
  userId: string
  email: string
  role: 'admin' | 'tienda' | 'billetera'
  storeId: string | null
  wallet: string | null                                  // solo rol 'billetera': su billetera
  billeteraPermiso: 'editor' | 'lectura' | null          // solo rol 'billetera'
  displayName: string | null
  aal2: boolean
  // Permisos del integrante DENTRO de su tienda PRIMARIA. Los 'admin' del sistema pueden
  // todo por su rol (las funciones de lib/permisos lo contemplan), así que su valor no importa.
  // Para operar una tienda concreta (que puede ser secundaria) usar resolveStorePermisos().
  permisos: Permisos
  // Todos los accesos del usuario (primario + extra). Con 1 solo elemento la app se ve
  // igual que siempre; con más de uno, el portal muestra el menú lateral para cambiar.
  accesos: Acceso[]
}

// Parsea app_users.accesos_extra (JSONB) → Acceso[]. Tolerante: descarta lo malformado.
function parseAccesosExtra(raw: unknown): Acceso[] {
  if (!Array.isArray(raw)) return []
  const out: Acceso[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id) continue
    if (o.tipo === 'tienda') {
      out.push({ tipo: 'tienda', id, permisos: sanearPermisos(o.permisos) })
    } else if (o.tipo === 'billetera') {
      out.push({ tipo: 'billetera', id, billeteraPermiso: o.billeteraPermiso === 'editor' ? 'editor' : 'lectura' })
    }
  }
  return out
}

// Usuario de la sesión actual, cruzado con app_users. null = sin sesión o sin permiso.
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const email = user.email.toLowerCase()
  const { data: row } = await serviceClient()
    .from('app_users')
    .select('email, role, store_id, wallet, billetera_permiso, display_name, permisos, accesos_extra')
    .eq('email', email)
    .maybeSingle<{ email: string; role: AppUser['role']; store_id: string | null; wallet: string | null; billetera_permiso: 'editor' | 'lectura' | null; display_name: string | null; permisos: unknown; accesos_extra: unknown }>()
  if (!row) return null

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  const permisos = sanearPermisos(row.permisos)

  // Unifico primario + extra en una sola lista de accesos. El primario sale de las
  // columnas de siempre (según el rol); los extra de accesos_extra. Sin duplicar.
  const accesos: Acceso[] = []
  if (row.role === 'tienda' && row.store_id) {
    accesos.push({ tipo: 'tienda', id: row.store_id, permisos })
  }
  if (row.role === 'billetera' && row.wallet) {
    accesos.push({ tipo: 'billetera', id: row.wallet, billeteraPermiso: row.billetera_permiso === 'editor' ? 'editor' : 'lectura' })
  }
  // Los admin operan todo desde /finanzas: no usan la lista de accesos (queda vacía).
  if (row.role !== 'admin') {
    for (const ex of parseAccesosExtra(row.accesos_extra)) {
      if (accesos.some(a => a.tipo === ex.tipo && a.id === ex.id)) continue  // el primario ya está
      accesos.push(ex)
    }
  }

  return {
    userId: user.id,
    email,
    role: row.role,
    storeId: row.store_id ?? null,
    wallet: row.wallet ?? null,
    billeteraPermiso: row.billetera_permiso ?? null,
    displayName: row.display_name ?? null,
    aal2: aal?.currentLevel === 'aal2',
    permisos,
    accesos,
  }
}

// Guard para rutas API. Exige sesión + fila en app_users + 2FA completo (AAL2).
// Con role='admin' exige además rol de administrador.
// Uso:  const auth = await requireUser();  if ('error' in auth) return auth.error
export async function requireUser(role?: 'admin' | 'billetera'): Promise<{ user: SessionUser } | { user?: never; error: NextResponse }> {
  const user = await getSessionUser()
  if (!user) return { error: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) }
  if (!user.aal2) return { error: NextResponse.json({ error: 'Se requiere completar el 2FA' }, { status: 401 }) }
  if (role === 'admin' && user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Solo Super Admin' }, { status: 403 }) }
  }
  // 'billetera' = tiene AL MENOS un acceso de billetera (primario o extra). Un usuario
  // con rol primario 'tienda' pero un acceso extra de billetera también entra acá; la
  // billetera concreta la valida resolveWalletScope contra sus accesos.
  if (role === 'billetera' && !user.accesos.some(a => a.tipo === 'billetera')) {
    return { error: NextResponse.json({ error: 'Solo dueños de billetera' }, { status: 403 }) }
  }
  return { user }
}

// storeId efectivo para rutas /api/tienda/**. Valida el storeId pedido contra los
// accesos del usuario (nunca se confía en el cliente):
//  - admin: vista espejo, usa el storeId explícito de cualquier tienda.
//  - resto: solo una tienda de sus accesos; si no pide una válida, cae en la primera
//    (que para un usuario de una sola tienda es la suya de siempre).
export function resolveStoreScope(user: SessionUser, requestedStoreId?: string | null): string | null {
  if (user.role === 'admin') return requestedStoreId || null
  const tiendas = user.accesos.filter((a): a is AccesoTienda => a.tipo === 'tienda')
  if (requestedStoreId) {
    const match = tiendas.find(t => t.id === requestedStoreId)
    if (match) return match.id
  }
  return tiendas[0]?.id ?? null
}

// Permisos efectivos para operar una tienda concreta (que puede ser un acceso
// secundario). Los admin pueden todo por su rol, así que su valor da igual.
export function resolveStorePermisos(user: SessionUser, storeId: string | null): Permisos {
  const acc = user.accesos.find((a): a is AccesoTienda => a.tipo === 'tienda' && a.id === storeId)
  return acc?.permisos ?? user.permisos
}

// Usuario "reducido" para los chequeos de lib/permisos (puede / puedeGestionarEquipo),
// con los permisos de la tienda que se está operando.
export function scopedUser(user: SessionUser, storeId: string | null): { role: SessionUser['role']; permisos: Permisos } {
  return { role: user.role, permisos: resolveStorePermisos(user, storeId) }
}

// Billetera efectiva para rutas /api/billetera/**. Valida la wallet pedida contra los
// accesos del usuario y devuelve además su permiso (editor/lectura) para ESA billetera.
// null = el usuario no tiene ese acceso (o ninguna billetera).
export function resolveWalletScope(user: SessionUser, requestedWallet?: string | null): { wallet: string; permiso: 'editor' | 'lectura' } | null {
  const bills = user.accesos.filter((a): a is AccesoBilletera => a.tipo === 'billetera')
  if (bills.length === 0) return null
  const chosen = requestedWallet ? bills.find(b => b.id === requestedWallet) : bills[0]
  if (!chosen) return null
  return { wallet: chosen.id, permiso: chosen.billeteraPermiso }
}
