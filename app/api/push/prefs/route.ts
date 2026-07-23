import { NextRequest, NextResponse } from 'next/server'
import { requireUser, setUnidad } from '@/lib/auth/server'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/push'
import { gruposPara, type NotificationPrefs, type EventoKey } from '@/lib/notificaciones'

// GET  /api/push/prefs → preferencias por grupo del usuario logueado.
// POST /api/push/prefs { prefs: { <evento>: boolean } } → las guarda.
// Admin y tienda: cada rol solo puede leer/guardar SUS grupos.

export async function GET() {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)
    const prefs = await getNotificationPrefs(auth.user.email)
    return NextResponse.json({ prefs })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if ('error' in auth) return auth.error
    // La unidad de negocio se aplica ACÁ, en el frame del handler (ver lib/unidad.ts).
    setUnidad(auth.user.unidad)

    const body = await req.json().catch(() => null)
    const entrada = body?.prefs
    if (!entrada || typeof entrada !== 'object') {
      return NextResponse.json({ error: 'Falta "prefs"' }, { status: 400 })
    }
    // Solo las claves del ROL del usuario, y valores booleanos: una tienda no puede
    // guardarse grupos de admin ni mandar basura.
    const permitidas = new Set(gruposPara(auth.user.role).map(g => g.key))
    const limpias: NotificationPrefs = {}
    for (const [k, v] of Object.entries(entrada)) {
      if (permitidas.has(k as EventoKey) && typeof v === 'boolean') limpias[k as EventoKey] = v
    }
    await setNotificationPrefs(auth.user.email, limpias)
    return NextResponse.json({ success: true, prefs: limpias })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
