import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

function makeSessionToken(username: string): string {
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  return createHmac('sha256', secret).update(username).digest('hex')
}

// Rutas de cron que aceptan CRON_SECRET en vez de sesión
const CRON_ROUTES = new Set(['/api/run', '/api/auto-match-run', '/api/reevaluar'])

// Rutas públicas (no requieren auth)
function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith('/login')
    || pathname.startsWith('/api/auth')
    || pathname.startsWith('/api/tn/callback')
    || pathname.startsWith('/api/shopify/callback')
    || pathname.startsWith('/api/tn/connect')
    || pathname.startsWith('/api/shopify/connect')
}

export function proxy(req: NextRequest) {
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

  const session = req.cookies.get('cb_session')?.value
  const validToken = makeSessionToken(process.env.AUTH_USERNAME || 'Benancio')

  if (session !== validToken) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|otf)$).*)'],
}
