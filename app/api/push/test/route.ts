import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { sendPushNotification } from '@/lib/push'

// POST /api/push/test — envía una notificación de PRUEBA al propio usuario.
// Sirve solo para verificar que el sistema funciona; NO es una notificación de
// evento (todavía no hay disparadores por evento).
export async function POST() {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error

    const r = await sendPushNotification(auth.user.email, {
      title: 'CriptoBlue',
      body: 'Notificación de prueba ✓ — las notificaciones están funcionando.',
      url: '/',
    })
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
