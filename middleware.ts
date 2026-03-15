import { NextRequest, NextResponse } from 'next/server'

async function makeSessionToken(username: string): Promise<string> {
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(username))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function isValidSession(token: string): Promise<boolean> {
  const username = process.env.AUTH_USERNAME || 'Benancio'
  const expected = await makeSessionToken(username)
  return token === expected
}

export async function middleware(req: NextRequest) {
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
  if (!token || !(await isValidSession(token))) {
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
