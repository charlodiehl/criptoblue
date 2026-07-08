import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// ─────────────────────────────────────────────────────────────────────────────
// Middleware de sesión (Supabase Auth: Google OAuth + 2FA TOTP obligatorio).
//
// Orden de evaluación:
//  1. Rutas públicas (webhooks con secreto propio, OAuth de tiendas, login/auth).
//  2. Rutas de cron con CRON_SECRET.
//  3. Resto: sesión válida + rol asignado (claim cb_role del JWT, seteado por
//     /auth/callback desde la tabla app_users) + AAL2 (2FA verificado).
//     Rol 'tienda' solo accede a /tienda/** y /api/tienda/**.
//
// El claim del JWT es infalsificable (lo firma Supabase). Las rutas API además
// re-verifican contra app_users vía requireUser() — revocación inmediata.
// ─────────────────────────────────────────────────────────────────────────────

// Rutas de cron que aceptan CRON_SECRET en vez de sesión
const CRON_ROUTES = new Set(['/api/run', '/api/auto-match-run', '/api/reevaluar', '/api/cron/cotizaciones'])

// Rutas públicas (no requieren auth de sesión)
function isPublicRoute(pathname: string): boolean {
  return pathname === '/manifest.json'
    || pathname === '/sw.js'
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/login')
    || pathname.startsWith('/auth/callback')
    || pathname.startsWith('/auth/mfa')
    || pathname.startsWith('/auth/redirect')
    || pathname.startsWith('/api/auth')
    || pathname.startsWith('/api/tn/callback')
    || pathname.startsWith('/api/shopify/callback')
    || pathname.startsWith('/api/tn/connect')
    || pathname.startsWith('/api/shopify/connect')
    || pathname.startsWith('/api/fiwind/webhook') // valida por su propio secreto (servicio externo)
    || pathname.startsWith('/api/notificador/webhook') // valida por su propio secreto (servicio externo)
    || pathname.startsWith('/api/montemar/webhook') // valida por su propio secreto (servicio externo)
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublicRoute(pathname)) return NextResponse.next()

  // CRON_SECRET solo válido para rutas de cron (no para el resto de APIs)
  if (CRON_ROUTES.has(pathname)) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const customHeader = req.headers.get('x-cron-secret')
    if (cronSecret && (authHeader === `Bearer ${cronSecret}` || customHeader === cronSecret)) {
      return NextResponse.next()
    }
  }

  // ── Sesión Supabase (patrón @supabase/ssr: refresca cookies si hace falta) ──
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isApi = pathname.startsWith('/api/')
  const redirect = (path: string) => {
    const url = req.nextUrl.clone()
    const [p, search] = path.split('?')
    url.pathname = p
    url.search = search ? `?${search}` : ''
    const r = NextResponse.redirect(url)
    // Conservar las cookies refrescadas por Supabase en la redirección.
    res.cookies.getAll().forEach(c => r.cookies.set(c))
    return r
  }
  const deny = (status: number, error: string) => NextResponse.json({ error }, { status })

  if (!user) return isApi ? deny(401, 'No autorizado') : redirect('/login')

  // Rol desde el claim del JWT (sincronizado con app_users por /auth/callback).
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.cb_role
  if (role !== 'admin' && role !== 'tienda') {
    return isApi ? deny(403, 'Sin permiso') : redirect('/login?blocked=1')
  }

  // 2FA obligatorio: sin AAL2 no se pasa (la página /auth/mfa es pública).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== 'aal2') {
    return isApi ? deny(401, 'Se requiere completar el 2FA') : redirect('/auth/mfa')
  }

  // Gate por rol: una tienda solo ve su portal y sus APIs.
  if (role === 'tienda') {
    const permitido = pathname === '/tienda'
      || pathname.startsWith('/tienda/')
      || pathname.startsWith('/api/tienda/')
    if (!permitido) return isApi ? deny(403, 'Solo administradores') : redirect('/tienda')
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|otf)$).*)'],
}
