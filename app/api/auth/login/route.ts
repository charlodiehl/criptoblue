import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

function makeSessionToken(username: string): string {
  const secret = process.env.AUTH_SECRET || 'criptoblue-secret'
  return createHmac('sha256', secret).update(username).digest('hex')
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  const validUser = process.env.AUTH_USERNAME || 'Benancio'
  const validPass = process.env.AUTH_PASSWORD
  if (!validPass) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (username !== validUser || password !== validPass) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = makeSessionToken(username)

  const res = NextResponse.json({ ok: true })
  res.cookies.set('cb_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 días
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('cb_session')
  return res
}
