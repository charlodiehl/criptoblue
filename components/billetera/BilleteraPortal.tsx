'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import BilleteraTab from '@/components/finanzas/BilleteraTab'
import type { BilleteraPermiso } from '@/lib/types'

export type Toast = { id: number; msg: string; type: 'success' | 'error' | 'info' }

interface Props {
  wallet: string
  permiso: BilleteraPermiso
  userEmail?: string
}

// Portal del dueño de una billetera: ve SOLO su billetera. 'editor' además puede
// retirar; 'lectura' solo mira saldos y navega el registro por fecha.
export default function BilleteraPortal({ wallet, permiso, userEmail }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const notify = useCallback((msg: string, type: Toast['type'] = 'info') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    window.location.href = '/login'
  }

  const esEditor = permiso === 'editor'

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% -10%, #0a1628 0%, #060b14 55%)' }}>
      <header className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 items-center gap-2 sm:gap-4"
          style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
          {/* Usuario */}
          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative flex items-center">
              <button onClick={() => setMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full transition-all"
                style={{ background: 'linear-gradient(135deg, #00d4ff22, #0070f322)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute left-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden z-50"
                  style={{ top: '100%', background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                  {userEmail && (
                    <div className="px-4 py-3 text-xs" style={{ color: 'rgba(148,163,184,0.7)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                      <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'rgba(0,212,255,0.55)' }}>
                        Dueño de billetera · {esEditor ? 'Editor' : 'Solo lectura'}
                      </div>
                      <div className="truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>{userEmail}</div>
                    </div>
                  )}
                  <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-2" style={{ color: '#f87171' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span>→</span> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Logo + título */}
          <div className="flex flex-col items-center gap-1 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CriptoBlue" className="h-11 w-11 sm:h-14 sm:w-14 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5)' }} />
            <span className="text-[10px] sm:text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.85)', letterSpacing: '0.12em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}>
              Portal de Billetera
            </span>
          </div>

          {/* Billetera + permiso */}
          <div className="flex items-center justify-end gap-2 min-w-0">
            <div className="text-right min-w-0">
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.5)' }}>Billetera</div>
              <div className="text-xs sm:text-sm font-bold truncate" style={{ color: '#00d4ff', textShadow: '0 0 12px rgba(0,212,255,0.3)' }}>{wallet}</div>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
              style={esEditor
                ? { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' }
                : { background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', color: 'rgba(148,163,184,0.9)' }}>
              {esEditor ? 'Editor' : 'Solo lectura'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6">
        <BilleteraTab
          wallet={wallet}
          notify={notify}
          apiBase="/api/billetera"
          puedeRetirar={esEditor}
          puedeEditar={false}
        />
      </main>

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
