'use client'

import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Hook de notificaciones Web Push (PWA). Pide permiso, crea la suscripción con la
// clave pública VAPID y la guarda en el backend (/api/push/subscribe).
// ─────────────────────────────────────────────────────────────────────────────

interface PushState {
  isSupported: boolean
  isSubscribed: boolean
  isLoading: boolean
  permission: NotificationPermission
  error: string | null
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function checkSupport(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    permission: 'default',
    error: null,
  })

  // Estado inicial: soporte + si ya hay una suscripción activa en este navegador.
  useEffect(() => {
    let cancel = false
    const init = async () => {
      if (!checkSupport()) {
        if (!cancel) setState(s => ({ ...s, isSupported: false, isLoading: false }))
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancel) setState(s => ({ ...s, isSupported: true, isSubscribed: !!sub, permission: Notification.permission, isLoading: false }))
      } catch {
        if (!cancel) setState(s => ({ ...s, isSupported: true, isLoading: false }))
      }
    }
    init()
    return () => { cancel = true }
  }, [])

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!checkSupport()) {
      setState(s => ({ ...s, error: 'Este navegador no soporta notificaciones' }))
      return false
    }
    setState(s => ({ ...s, isLoading: true, error: null }))
    try {
      let permission = Notification.permission
      if (permission === 'default') permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(s => ({ ...s, isLoading: false, permission, error: 'Permiso de notificaciones denegado' }))
        return false
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) throw new Error('VAPID public key no configurada')

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al guardar la suscripción')
      }

      setState({ isSupported: true, isSubscribed: true, isLoading: false, permission: 'granted', error: null })
      return true
    } catch (error) {
      setState(s => ({ ...s, isLoading: false, error: error instanceof Error ? error.message : 'Error al activar notificaciones' }))
      return false
    }
  }, [])

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState(s => ({ ...s, isLoading: true, error: null }))
    try {
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()
      if (subscription) {
        await subscription.unsubscribe()
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      }
      setState(s => ({ ...s, isSubscribed: false, isLoading: false, error: null }))
      return true
    } catch {
      setState(s => ({ ...s, isLoading: false, error: 'Error al desactivar notificaciones' }))
      return false
    }
  }, [])

  return { ...state, subscribe, unsubscribe }
}

/** True si la app corre instalada como PWA (standalone). */
export function useIsPWA(): boolean {
  const [isPWA, setIsPWA] = useState(false)
  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsPWA(standalone)
  }, [])
  return isPWA
}

/** Plataforma del dispositivo, para instrucciones de instalación. */
export function usePlatform(): 'ios' | 'android' | 'desktop' | 'unknown' {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop' | 'unknown'>('unknown')
  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase()
    if (/iphone|ipad|ipod/.test(ua)) setPlatform('ios')
    else if (/android/.test(ua)) setPlatform('android')
    else if (/windows|macintosh|linux/.test(ua)) setPlatform('desktop')
  }, [])
  return platform
}
