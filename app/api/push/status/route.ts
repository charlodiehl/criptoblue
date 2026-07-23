import { NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { userHasPushSubscription } from '@/lib/push'

// GET /api/push/status — clave pública VAPID + si el usuario ya tiene suscripción.
export async function GET() {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null
    const subscribed = await userHasPushSubscription(auth.user.email)
    return NextResponse.json({ success: true, publicKey, subscribed, configured: !!publicKey })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
