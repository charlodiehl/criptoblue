'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import TiendaPortal from '@/components/tienda/TiendaPortal'
import BilleteraTab from '@/components/finanzas/BilleteraTab'
import type { Permisos } from '@/lib/permisos'

export type Toast = { id: number; msg: string; type: 'success' | 'error' | 'info' }

// Ítem de acceso ya resuelto para la UI (el label de tienda es su nombre; el de
// billetera es la wallet misma). Serializable: lo arma el server component.
export type AccesoUI =
  | { tipo: 'tienda'; id: string; label: string; permisos: Permisos }
  | { tipo: 'billetera'; id: string; label: string; permiso: 'editor' | 'lectura' }

const keyOf = (a: AccesoUI) => `${a.tipo}:${a.id}`

// Portal multi-acceso: aparece cuando un usuario tiene acceso a más de una tienda y/o
// billetera. Menú lateral con los nombres a la izquierda; a la derecha, el portal de la
// tienda (vista embebida) o la billetera seleccionada. Con un solo acceso NO se usa esto
// (las páginas /tienda y /billetera muestran el portal simple de siempre).
export default function MultiAccesoApp({ items, userEmail }: { items: AccesoUI[]; userEmail?: string }) {
  const [active, setActive] = useState<string>(() => (items[0] ? keyOf(items[0]) : ''))
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const notify = useCallback((msg: string, type: Toast['type'] = 'info') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    if (!userMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [userMenuOpen])

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    window.location.href = '/login'
  }

  const tiendas = items.filter((a): a is Extract<AccesoUI, { tipo: 'tienda' }> => a.tipo === 'tienda')
  const billeteras = items.filter((a): a is Extract<AccesoUI, { tipo: 'billetera' }> => a.tipo === 'billetera')
  const activo = items.find(a => keyOf(a) === active) ?? items[0]

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% -10%, #0a1628 0%, #060b14 55%)' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl safe-top"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-3 items-center gap-3 sm:gap-4"
          style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
          {/* LEFT: usuario */}
          <div className="flex items-center gap-2">
            <div ref={userMenuRef} className="relative flex items-center">
              <button
                onClick={() => setUserMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full transition-all"
                style={{ background: 'linear-gradient(135deg, #00d4ff22, #0070f322)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute left-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden z-50"
                  style={{ top: '100%', background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                  {userEmail && (
                    <div className="px-4 py-3 text-xs" style={{ color: 'rgba(148,163,184,0.7)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                      <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'rgba(0,212,255,0.55)' }}>Sesión</div>
                      <div className="truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>{userEmail}</div>
                    </div>
                  )}
                  <Link href="/notificaciones" className="w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-2" style={{ color: 'rgba(226,232,240,0.9)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span>🔔</span> Notificaciones
                  </Link>
                  <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-2" style={{ color: '#f87171' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span>→</span> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* CENTER: logo */}
          <div className="flex flex-col items-center gap-1 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CriptoBlue" className="h-11 w-11 sm:h-14 sm:w-14 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5)' }} />
            <span className="text-[10px] sm:text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.85)', letterSpacing: '0.12em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}>
              Automatización de Procesos
            </span>
          </div>

          {/* RIGHT: vacío (equilibra el grid) */}
          <div />
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-5">
        {/* Menú lateral + panel. En móvil el menú es una fila horizontal scrolleable. */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-5 items-stretch md:items-start">
          <aside className="w-full md:w-56 md:shrink-0 flex md:block gap-1.5 md:space-y-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            {tiendas.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-widest px-3 pt-1 pb-1 shrink-0 self-center md:self-auto whitespace-nowrap" style={{ color: 'rgba(148,163,184,0.4)' }}>Tiendas</div>
                {tiendas.map(a => (
                  <SideItem key={keyOf(a)} label={a.label} active={active === keyOf(a)} onClick={() => setActive(keyOf(a))} />
                ))}
              </>
            )}
            {billeteras.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-widest px-3 pt-3 pb-1 shrink-0 self-center md:self-auto whitespace-nowrap" style={{ color: 'rgba(148,163,184,0.4)' }}>Billeteras</div>
                {billeteras.map(a => (
                  <SideItem key={keyOf(a)} label={a.label} active={active === keyOf(a)} onClick={() => setActive(keyOf(a))} />
                ))}
              </>
            )}
          </aside>

          <main className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {activo?.tipo === 'tienda' ? (
                  <TiendaPortal key={activo.id} storeId={activo.id} embedded permisos={activo.permisos} userEmail={userEmail} />
                ) : activo?.tipo === 'billetera' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold" style={{ color: '#00d4ff' }}>{activo.label}</h2>
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
                        style={activo.permiso === 'editor'
                          ? { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' }
                          : { background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', color: 'rgba(148,163,184,0.9)' }}>
                        {activo.permiso === 'editor' ? 'Editor' : 'Solo lectura'}
                      </span>
                    </div>
                    <BilleteraTab key={activo.id} wallet={activo.id} notify={notify} apiBase="/api/billetera" puedeRetirar={activo.permiso === 'editor'} puedeEditar={false} />
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              className="px-4 py-3 rounded-xl text-sm max-w-xs shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #0d1117, #111827)',
                border: `1px solid ${t.type === 'error' ? 'rgba(248,113,113,0.4)' : t.type === 'success' ? 'rgba(0,255,136,0.4)' : 'rgba(0,212,255,0.3)'}`,
                color: t.type === 'error' ? '#f87171' : t.type === 'success' ? '#00ff88' : '#00d4ff',
              }}>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function SideItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-auto md:w-full shrink-0 whitespace-nowrap md:truncate text-left rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
      style={{
        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
        border: `1px solid ${active ? 'rgba(0,212,255,0.35)' : 'transparent'}`,
        color: active ? '#00d4ff' : 'rgba(148,163,184,0.8)',
      }}>
      {label}
    </button>
  )
}
