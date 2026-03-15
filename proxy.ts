import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

function makeSessionToken(username: string): string {
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  return createHmac('sha256', secret).update(username).digest('hex')
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rutas públicas que no requieren auth
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // Permitir requests de cron con CRON_SECRET válido
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (pathname.startsWith('/api/') && cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return NextResponse.next()
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
