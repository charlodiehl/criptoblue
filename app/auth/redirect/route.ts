import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/server'

// GET /auth/redirect — destino post-login/post-MFA: manda a cada rol a su casa.
// Lo usa /auth/mfa al completar la verificación (recarga completa para que el
// middleware vea el AAL2 nuevo en las cookies).
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const user = await getSessionUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)
  if (!user.aal2) return NextResponse.redirect(`${origin}/auth/mfa`)
  const destino = user.role === 'tienda' ? '/tienda' : user.role === 'billetera' ? '/billetera' : '/'
  return NextResponse.redirect(`${origin}${destino}`)
}
