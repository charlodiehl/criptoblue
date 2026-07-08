/**
 * Service Worker de CriptoBlue — Web Push (VAPID) + PWA instalable.
 *
 * Maneja:
 *   - push:                   muestra la notificación en la barra del teléfono.
 *   - notificationclick:      abre/enfoca la app en la URL de la notificación.
 *   - pushsubscriptionchange: re-suscribe si el navegador rota la suscripción.
 *   - fetch (no-op):          cumple el criterio "Installable" de Chrome/Android.
 */

const SW_VERSION = 'v1.0.0-webpush'

// Clave pública VAPID (es pública — puede ir en el cliente/SW). Debe coincidir con
// NEXT_PUBLIC_VAPID_PUBLIC_KEY. Se usa solo para re-suscribir en pushsubscriptionchange.
const VAPID_PUBLIC_KEY = 'BHKdLGAYWnt7QIMhtCBPF8xhTydZ46ZXtr944mJDxOG5jlNwkETy9vwQfD5_LHkaUgjj36KZEMrQtf3NY96s7Oc'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Recibir push → mostrar notificación
self.addEventListener('push', (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'CriptoBlue', body: event.data.text() }
  }
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/', ...data.data },
    tag: data.tag || `criptoblue-${Date.now()}`,
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(data.title || 'CriptoBlue', options))
})

// Click en la notificación → abrir/enfocar la app en la URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawUrl = event.notification.data?.url || '/'
  const urlToOpen = rawUrl.startsWith('http') ? rawUrl : `${self.location.origin}${rawUrl}`
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(urlToOpen)
    }),
  )
})

// El navegador rotó la suscripción → re-suscribir y reportar al backend
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
      .then((subscription) =>
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        }),
      )
      .catch((err) => console.error(`[SW ${SW_VERSION}] Re-suscripción falló:`, err)),
  )
})

// No-op: la presencia del listener habilita el criterio "Installable".
self.addEventListener('fetch', () => {})
