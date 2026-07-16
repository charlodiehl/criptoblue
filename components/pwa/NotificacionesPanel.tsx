'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePushNotifications, useIsPWA, usePlatform } from '@/hooks/use-push-notifications'
import { gruposPara, type EventoKey, type NotificationPrefs } from '@/lib/notificaciones'

// Página de preferencias de notificaciones (admin y tienda). Un toggle global que
// activa/desactiva las push del dispositivo, y —una vez activo— un toggle por cada
// grupo de eventos del rol. Todo es sobre la PWA instalada (acceso directo del navegador).
export default function NotificacionesPanel({ userEmail, role }: { userEmail: string; role: 'admin' | 'tienda' }) {
  const grupos = gruposPara(role)
  const volverA = role === 'admin' ? '/finanzas' : '/tienda'
  const { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe } = usePushNotifications()
  const isPWA = useIsPWA()
  const platform = usePlatform()
  const iosSinInstalar = platform === 'ios' && !isPWA

  const [prefs, setPrefs] = useState<NotificationPrefs>({})
  const [prefsCargadas, setPrefsCargadas] = useState(false)
  const [guardando, setGuardando] = useState<EventoKey | null>(null)
  const [probando, setProbando] = useState(false)
  const [avisoPrueba, setAvisoPrueba] = useState<string | null>(null)

  // Cargar preferencias por grupo cuando el usuario está suscripto.
  useEffect(() => {
    if (!isSubscribed) { setPrefsCargadas(false); return }
    let cancel = false
    ;(async () => {
      try {
        const res = await fetch('/api/push/prefs')
        const data = await res.json().catch(() => ({}))
        if (!cancel && res.ok) setPrefs(data.prefs || {})
      } catch { /* deja los defaults (todo activado) */ }
      finally { if (!cancel) setPrefsCargadas(true) }
    })()
    return () => { cancel = true }
  }, [isSubscribed])

  const toggleGlobal = () => { void (isSubscribed ? unsubscribe() : subscribe()) }

  const toggleGrupo = useCallback(async (key: EventoKey) => {
    const activo = prefs[key] !== false        // default: activado
    const nuevo: NotificationPrefs = { ...prefs, [key]: !activo }
    const anterior = prefs
    setPrefs(nuevo)                             // optimista
    setGuardando(key)
    try {
      const res = await fetch('/api/push/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: nuevo }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setPrefs(anterior)                        // revertir si falló
    } finally {
      setGuardando(null)
    }
  }, [prefs])

  const probar = async () => {
    setProbando(true); setAvisoPrueba(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setAvisoPrueba(res.ok && data.sent > 0 ? 'Notificación enviada ✓' : 'No se pudo enviar')
    } catch { setAvisoPrueba('No se pudo enviar') }
    finally { setProbando(false) }
  }

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% -10%, #0a1628 0%, #060b14 55%)' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href={volverA} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all whitespace-nowrap"
            style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)', color: '#00d4ff' }}>
            ← <span className="hidden sm:inline">Volver</span>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">🔔</span>
            <span className="text-sm font-semibold truncate" style={{ color: 'rgba(0,212,255,0.9)', letterSpacing: '0.04em' }}>Notificaciones</span>
          </div>
          <div className="w-[64px]" />
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 sm:px-6 py-6 space-y-4">
        {/* Toggle global */}
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'rgba(226,232,240,0.92)' }}>Notificaciones en este dispositivo</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>
                {isSubscribed ? 'Activas — recibís avisos en la barra del teléfono.' : 'Activalas para recibir avisos en la barra del teléfono.'}
              </p>
            </div>
            <button
              onClick={toggleGlobal}
              disabled={isLoading || !isSupported || iosSinInstalar}
              aria-pressed={isSubscribed}
              className="relative rounded-full transition-all disabled:opacity-40 shrink-0"
              style={{ width: '46px', height: '26px', background: isSubscribed ? '#00ff88' : 'rgba(148,163,184,0.25)', cursor: isLoading || !isSupported || iosSinInstalar ? 'default' : 'pointer' }}>
              <span className="absolute rounded-full transition-all" style={{ width: '20px', height: '20px', top: '3px', left: isSubscribed ? '23px' : '3px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
            </button>
          </div>

          {iosSinInstalar ? (
            <p className="text-[12px] mt-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}>
              En iPhone tenés que instalar la app primero: tocá Compartir → “Agregar a inicio”, y abrila desde ese ícono.
            </p>
          ) : !isSupported ? (
            <p className="text-[12px] mt-3" style={{ color: 'rgba(148,163,184,0.6)' }}>Este navegador no soporta notificaciones.</p>
          ) : isSubscribed ? (
            <button onClick={probar} disabled={probando} className="text-[12px] mt-3 transition-all disabled:opacity-50" style={{ color: 'rgba(0,212,255,0.8)' }}>
              {probando ? 'Enviando…' : avisoPrueba || 'Enviar notificación de prueba'}
            </button>
          ) : null}

          {error && <p className="text-[12px] mt-2" style={{ color: '#f87171' }}>{error}</p>}
        </div>

        {/* Grupos: solo cuando el global está activo */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)', opacity: isSubscribed ? 1 : 0.5 }}>
          <div className="px-4 sm:px-5 py-3" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,255,0.7)' }}>¿Qué querés recibir?</p>
            {!isSubscribed && <p className="text-[12px] mt-1" style={{ color: 'rgba(148,163,184,0.5)' }}>Activá las notificaciones para elegir.</p>}
          </div>
          {grupos.map((g, i) => {
            const activo = prefs[g.key] !== false
            const disabled = !isSubscribed || !prefsCargadas || guardando === g.key
            return (
              <div key={g.key} className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5"
                style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,0.05)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'rgba(226,232,240,0.9)' }}>{g.label}</p>
                  <p className="text-[12px] mt-0.5 leading-snug" style={{ color: 'rgba(148,163,184,0.55)' }}>{g.descripcion}</p>
                </div>
                <button
                  onClick={() => toggleGrupo(g.key)}
                  disabled={disabled}
                  aria-pressed={isSubscribed && activo}
                  className="relative rounded-full transition-all disabled:opacity-40 shrink-0 mt-0.5"
                  style={{ width: '38px', height: '22px', background: (isSubscribed && activo) ? '#00ff88' : 'rgba(148,163,184,0.25)', cursor: disabled ? 'default' : 'pointer' }}>
                  <span className="absolute rounded-full transition-all" style={{ width: '16px', height: '16px', top: '3px', left: (isSubscribed && activo) ? '19px' : '3px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                </button>
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-center px-2" style={{ color: 'rgba(148,163,184,0.4)' }}>
          Sesión: {userEmail}
        </p>
      </main>
    </div>
  )
}
