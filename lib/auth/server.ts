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

export interface SessionUser {
  userId: string
  email: string
  role: 'admin' | 'tienda' | 'billetera'
  storeId: string | null
  wallet: string | null                                  // solo rol 'billetera': su billetera
  billeteraPermiso: 'editor' | 'lectura' | null          // solo rol 'billetera'
  displayName: string | null
  aal2: boolean
  // Permisos del integrante DENTRO de su tienda. Los 'admin' del sistema pueden todo
  // por su rol (las funciones de lib/permisos lo contemplan), así que su valor no importa.
  permisos: Permisos
}

// Usuario de la sesión actual, cruzado con app_users. null = sin sesión o sin permiso.
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const email = user.email.toLowerCase()
  const { data: row } = await serviceClient()
    .from('app_users')
    .select('email, role, store_id, wallet, billetera_permiso, display_name, permisos')
    .eq('email', email)
    .maybeSingle<{ email: string; role: AppUser['role']; store_id: string | null; wallet: string | null; billetera_permiso: 'editor' | 'lectura' | null; display_name: string | null; permisos: unknown }>()
  if (!row) return null

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  return {
    userId: user.id,
    email,
    role: row.role,
    storeId: row.store_id ?? null,
    wallet: row.wallet ?? null,
    billeteraPermiso: row.billetera_permiso ?? null,
    displayName: row.display_name ?? null,
    aal2: aal?.currentLevel === 'aal2',
    permisos: sanearPermisos(row.permisos),
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
  if (role === 'billetera' && user.role !== 'billetera') {
    return { error: NextResponse.json({ error: 'Solo dueños de billetera' }, { status: 403 }) }
  }
  return { user }
}

// storeId efectivo para rutas /api/tienda/**.
// Rol tienda: SIEMPRE su propia tienda (ignora cualquier storeId del request —
// nunca se confía en el cliente). Rol admin: usa el storeId explícito (vista espejo).
export function resolveStoreScope(user: SessionUser, requestedStoreId?: string | null): string | null {
  if (user.role === 'tienda') return user.storeId
  return requestedStoreId || null
}
