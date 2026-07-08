'use client'

import { useState } from 'react'
import { usePushNotifications, useIsPWA, usePlatform } from '@/hooks/use-push-notifications'

// Bloque de "Notificaciones" para el menú de usuario (dropdown del avatar).
// Activa/desactiva las push del dispositivo actual y permite enviarse una prueba.
export default function NotificacionesToggle() {
  const { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe } = usePushNotifications()
  const isPWA = useIsPWA()
  const platform = usePlatform()
  const [probando, setProbando] = useState(false)
  const [avisoPrueba, setAvisoPrueba] = useState<string | null>(null)

  // iOS solo entrega push si la app está instalada como PWA (iOS 16.4+).
  const iosSinInstalar = platform === 'ios' && !isPWA

  const toggle = () => { void (isSubscribed ? unsubscribe() : subscribe()) }

  const probar = async () => {
    setProbando(true)
    setAvisoPrueba(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setAvisoPrueba(res.ok && data.sent > 0 ? 'Enviada ✓' : 'No se pudo enviar')
    } catch {
      setAvisoPrueba('No se pudo enviar')
    } finally {
      setProbando(false)
    }
  }

  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm" style={{ color: 'rgba(226,232,240,0.9)' }}>Notificaciones</span>
        <button
          onClick={toggle}
          disabled={isLoading || !isSupported || iosSinInstalar}
          aria-pressed={isSubscribed}
          className="relative rounded-full transition-all disabled:opacity-40"
          style={{
            width: '38px', height: '22px', flexShrink: 0,
            background: isSubscribed ? '#00ff88' : 'rgba(148,163,184,0.25)',
            cursor: isLoading || !isSupported || iosSinInstalar ? 'default' : 'pointer',
          }}
        >
          <span className="absolute rounded-full transition-all" style={{
            width: '16px', height: '16px', top: '3px', left: isSubscribed ? '19px' : '3px',
            background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }} />
        </button>
      </div>

      {iosSinInstalar ? (
        <p className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.6)' }}>
          Instalá la app (Compartir → “Agregar a inicio”) para recibir notificaciones.
        </p>
      ) : !isSupported ? (
        <p className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.6)' }}>
          Este navegador no soporta notificaciones.
        </p>
      ) : isSubscribed ? (
        <button onClick={probar} disabled={probando}
          className="text-[11px] mt-1.5 transition-all disabled:opacity-50"
          style={{ color: 'rgba(0,212,255,0.8)' }}>
          {probando ? 'Enviando…' : avisoPrueba || 'Enviar notificación de prueba'}
        </button>
      ) : null}

      {error && <p className="text-[11px] mt-1.5" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  )
}
