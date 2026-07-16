// ─────────────────────────────────────────────────────────────────────────────
// Web Push (VAPID) — envío de notificaciones a la barra del teléfono vía PWA.
//
// Las suscripciones se guardan en la tabla push_subscriptions (una por usuario y
// navegador), keyeadas por el email del usuario (app_users.email).
//
// IMPORTANTE: las funciones de ENVÍO (sendPushNotification*) quedan listas pero
// TODAVÍA NO se llaman desde ningún evento de negocio. El único disparador actual
// es /api/push/test (prueba manual). Cuando se quiera notificar un evento, llamar
// a sendPushNotification(email, payload) desde el punto correspondiente.
// ─────────────────────────────────────────────────────────────────────────────

import webpush from 'web-push'
import { getClient } from './storage'
import { quiereEvento, type EventoKey, type EventoAdminKey, type EventoTiendaKey, type NotificationPrefs } from './notificaciones'

const TABLE = 'push_subscriptions'
const PREFS_TABLE = 'notification_prefs'

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:padeleroapp@gmail.com'

let vapidConfigured = false
function ensureVapid(): boolean {
  if (vapidConfigured) return true
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[Push] VAPID keys no configuradas — Web Push deshabilitado')
    return false
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  vapidConfigured = true
  return true
}

export interface PushSubscriptionData {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PushNotificationPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  url?: string
  data?: Record<string, unknown>
}

interface StoredSub {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

// ─── Suscripciones ───────────────────────────────────────────────────────────

export async function savePushSubscription(email: string, sub: PushSubscriptionData, userAgent?: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (getClient().from(TABLE) as any).upsert(
      {
        user_email: email.toLowerCase(),
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,endpoint' },
    )
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[Push] Error guardando suscripción:', err)
    return false
  }
}

export async function removePushSubscription(email: string, endpoint: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (getClient().from(TABLE) as any)
      .delete()
      .eq('user_email', email.toLowerCase())
      .eq('endpoint', endpoint)
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[Push] Error eliminando suscripción:', err)
    return false
  }
}

export async function getUserPushSubscriptions(email: string): Promise<StoredSub[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from(TABLE) as any)
    .select('id, endpoint, p256dh, auth')
    .eq('user_email', email.toLowerCase())
  if (error) throw new Error(`getUserPushSubscriptions falló: ${error.message} [${error.code}]`)
  return (data ?? []) as StoredSub[]
}

export async function userHasPushSubscription(email: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (getClient().from(TABLE) as any)
    .select('id', { count: 'exact', head: true })
    .eq('user_email', email.toLowerCase())
  if (error) throw new Error(`userHasPushSubscription falló: ${error.message} [${error.code}]`)
  return (count ?? 0) > 0
}

// ─── Envío (listo para usar; aún sin disparadores por evento) ─────────────────

export async function sendPushNotification(email: string, payload: PushNotificationPayload): Promise<{ sent: number; failed: number }> {
  const results = { sent: 0, failed: 0 }
  if (!ensureVapid()) return results

  const subs = await getUserPushSubscriptions(email)
  if (subs.length === 0) return results

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-96.png',
    url: payload.url || '/',
    data: payload.data,
  })

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { urgency: 'high', TTL: 86400 },
      )
      results.sent++
    } catch (err: unknown) {
      results.failed++
      const statusCode = (err as { statusCode?: number }).statusCode
      // 410 Gone / 404 Not Found → suscripción muerta, la borramos.
      if (statusCode === 410 || statusCode === 404) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (getClient().from(TABLE) as any).delete().eq('id', sub.id).then(undefined, () => {})
      }
    }
  }
  console.log(`[Push] email=${email} sent=${results.sent} failed=${results.failed} (subs=${subs.length})`)
  return results
}

export async function sendPushNotificationToEmails(emails: string[], payload: PushNotificationPayload): Promise<{ sent: number; failed: number }> {
  const results = { sent: 0, failed: 0 }
  for (const email of emails) {
    const r = await sendPushNotification(email, payload)
    results.sent += r.sent
    results.failed += r.failed
  }
  return results
}

// ─── Administradores + preferencias por grupo ─────────────────────────────────

// Emails (lowercase) de todos los administradores.
export async function getAdminEmails(): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email').eq('role', 'admin')
  if (error) throw new Error(`getAdminEmails falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => String(r.email).toLowerCase())
}

// Emails (lowercase) de los usuarios de UNA tienda.
export async function getEmailsDeTienda(storeId: string): Promise<string[]> {
  if (!storeId) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from('app_users') as any)
    .select('email').eq('role', 'tienda').eq('store_id', storeId)
  if (error) throw new Error(`getEmailsDeTienda falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => String(r.email).toLowerCase())
}

export async function getNotificationPrefs(email: string): Promise<NotificationPrefs> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from(PREFS_TABLE) as any)
    .select('prefs').eq('user_email', email.toLowerCase()).maybeSingle()
  if (error) throw new Error(`getNotificationPrefs falló: ${error.message} [${error.code}]`)
  return (data?.prefs ?? {}) as NotificationPrefs
}

export async function setNotificationPrefs(email: string, prefs: NotificationPrefs): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getClient().from(PREFS_TABLE) as any).upsert(
    { user_email: email.toLowerCase(), prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_email' },
  )
  if (error) throw new Error(`setNotificationPrefs falló: ${error.message} [${error.code}]`)
}

// Preferencias de varios usuarios de una (email lowercase → prefs).
async function getPrefsForEmails(emails: string[]): Promise<Record<string, NotificationPrefs>> {
  const map: Record<string, NotificationPrefs> = {}
  if (!emails.length) return map
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().from(PREFS_TABLE) as any)
    .select('user_email, prefs').in('user_email', emails)
  if (error) throw new Error(`getPrefsForEmails falló: ${error.message} [${error.code}]`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) map[String(r.user_email).toLowerCase()] = (r.prefs ?? {}) as NotificationPrefs
  return map
}

// Envía a los que tengan ESE grupo activado (default: sí, mientras no lo apaguen).
async function notificarA(emails: string[], evento: EventoKey, payload: PushNotificationPayload): Promise<void> {
  if (!emails.length) return
  const prefs = await getPrefsForEmails(emails)
  const destinatarios = emails.filter(e => quiereEvento(prefs[e], evento))
  if (!destinatarios.length) return
  await sendPushNotificationToEmails(destinatarios, payload)
}

// Notifica a TODOS los administradores.
// Best-effort: nunca lanza — si el push falla, el evento de negocio igual se completa.
export async function notifyAdmins(evento: EventoAdminKey, payload: PushNotificationPayload): Promise<void> {
  try {
    await notificarA(await getAdminEmails(), evento, payload)
  } catch (err) {
    console.error('[Push] notifyAdmins error:', err)
  }
}

// Notifica a los usuarios de UNA tienda. Best-effort (ídem notifyAdmins).
export async function notifyTienda(storeId: string | null | undefined, evento: EventoTiendaKey, payload: PushNotificationPayload): Promise<void> {
  try {
    if (!storeId) return
    await notificarA(await getEmailsDeTienda(storeId), evento, payload)
  } catch (err) {
    console.error('[Push] notifyTienda error:', err)
  }
}
