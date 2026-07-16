import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/server'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/push'
import { GRUPOS_NOTIFICACION, type NotificationPrefs, type EventoKey } from '@/lib/notificaciones'

// GET  /api/push/prefs → preferencias por grupo del admin logueado.
// POST /api/push/prefs { prefs: { <evento>: boolean } } → las guarda.
// Solo administradores (las notificaciones por evento son solo para admins por ahora).

const KEYS = new Set(GRUPOS_NOTIFICACION.map(g => g.key))

export async function GET() {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error
    const prefs = await getNotificationPrefs(auth.user.email)
    return NextResponse.json({ prefs })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser('admin')
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => null)
    const entrada = body?.prefs
    if (!entrada || typeof entrada !== 'object') {
      return NextResponse.json({ error: 'Falta "prefs"' }, { status: 400 })
    }
    // Solo claves conocidas y valores booleanos (defensa contra basura del cliente).
    const limpias: NotificationPrefs = {}
    for (const [k, v] of Object.entries(entrada)) {
      if (KEYS.has(k as EventoKey) && typeof v === 'boolean') limpias[k as EventoKey] = v
    }
    await setNotificationPrefs(auth.user.email, limpias)
    return NextResponse.json({ success: true, prefs: limpias })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
