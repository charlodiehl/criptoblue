import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { removePushSubscription } from '@/lib/push'

// POST /api/push/unsubscribe — elimina la suscripción Web Push del navegador actual.
// Body: { endpoint: string }
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const endpoint = body?.endpoint
    if (!endpoint) return NextResponse.json({ error: 'endpoint requerido' }, { status: 400 })

    const ok = await removePushSubscription(auth.user.email, endpoint)
    return NextResponse.json({ success: ok })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
