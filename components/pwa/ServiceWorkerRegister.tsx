'use client'

import { useEffect } from 'react'

/**
 * Registra el Service Worker en /sw.js: habilita Web Push (notificaciones a la
 * barra del teléfono) y el criterio "Installable" de Chrome/Android (PWA).
 * No bloqueante: si falla el registro, la app sigue funcionando normal.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('[PWA] Registro del Service Worker falló:', err)
    })
  }, [])
  return null
}
