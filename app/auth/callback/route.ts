import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, serviceClient } from '@/lib/auth/server'

// GET /auth/callback?code=...
//
// Aterrizaje del OAuth de Google (Supabase Auth, flujo PKCE). Pasos:
//  1. Canjea el code por la sesión (cookies).
//  2. Busca el email en app_users. Sin fila → signOut + /login?blocked=1
//     (pantalla "No tenés permiso para acceder").
//  3. Sincroniza rol/tienda al JWT (app_metadata.cb_role / cb_store_id) para que
//     el middleware pueda filtrar por rol sin consultar la base en cada request.
//  4. Redirige a /auth/mfa: enrolar el 2FA (primer ingreso) o pasar el challenge.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(`${origin}/login?error=oauth`)

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const email = data.user.email.toLowerCase()
  const svc = serviceClient()
  const { data: row } = await svc
    .from('app_users')
    .select('role, store_id')
    .eq('email', email)
    .maybeSingle<{ role: string; store_id: string | null }>()

  if (!row) {
    // Email sin rol asignado: se bloquea el ingreso.
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?blocked=1`)
  }

  // Mantener el claim del JWT en línea con la tabla (el middleware filtra por esto).
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>
  if (meta.cb_role !== row.role || (meta.cb_store_id ?? null) !== (row.store_id ?? null)) {
    await svc.auth.admin.updateUserById(data.user.id, {
      app_metadata: { cb_role: row.role, cb_store_id: row.store_id ?? null },
    })
    // Refresca la sesión para que el JWT nuevo (con claims) quede en las cookies.
    await supabase.auth.refreshSession()
  }

  return NextResponse.redirect(`${origin}/auth/mfa`)
}
