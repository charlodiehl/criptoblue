import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { savePushSubscription } from '@/lib/push'

// POST /api/push/subscribe — guarda la suscripción Web Push del navegador actual.
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const sub = body?.subscription
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })
    }

    const userAgent = req.headers.get('user-agent') ?? undefined
    const ok = await savePushSubscription(auth.user.email, sub, userAgent)
    if (!ok) return NextResponse.json({ error: 'No se pudo guardar la suscripción' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
