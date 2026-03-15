import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

function makeSessionToken(username: string): string {
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  return createHmac('sha256', secret).update(username).digest('hex')
}

function isValidSession(token: string): boolean {
  const username = process.env.AUTH_USERNAME || 'Benancio'
  const expected = makeSessionToken(username)
  return token === expected
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rutas públicas: login y sus assets
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // El cron puede llamar a /api/reevaluar con su propio secret — dejar pasar
  if (pathname === '/api/reevaluar') {
    return NextResponse.next()
  }

  const token = req.cookies.get('cb_session')?.value
  if (!token || !isValidSession(token)) {
    // API routes → 401 JSON, no redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png).*)'],
}
