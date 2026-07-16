'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import BalanceTab from './BalanceTab'
import SolicitarTab from './SolicitarTab'
import BuscarPagosTab from './BuscarPagosTab'
import SolicitarReembolsoTab from './SolicitarReembolsoTab'

export type Toast = { id: number; msg: string; type: 'success' | 'error' | 'info' }

interface Props {
  storeId: string
  storeName: string
  userEmail?: string
  // Vista espejo del admin (O2): sin header propio, y las llamadas a /api/tienda/**
  // van con ?storeId= explícito.
  admin?: boolean
  // Señal de refresco en tiempo real (desde FinanzasApp): al marcar una orden, el
  // BalanceTab re-consulta el saldo. Solo se usa en la vista espejo del admin.
  refreshKey?: number
}

type Tab = 'balance' | 'solicitar' | 'buscar' | 'reembolso'

const TABS: { key: Tab; label: string }[] = [
  { key: 'balance', label: 'Balance de Saldo' },
  { key: 'solicitar', label: 'Solicitar transferencias' },
  { key: 'buscar', label: 'Buscar pagos' },
  { key: 'reembolso', label: 'Solicitar reembolsos' },
]

export default function TiendaPortal({ storeId, storeName, userEmail, admin = false, refreshKey = 0 }: Props) {
  const [tab, setTab] = useState<Tab>('balance')
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

  // Sufijo de query para que la vista espejo del admin apunte a la tienda correcta.
  const qs = admin ? `?storeId=${encodeURIComponent(storeId)}` : ''

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18 }}
      >
        {tab === 'balance' && <BalanceTab storeId={storeId} qs={qs} notify={notify} admin={admin} refreshKey={refreshKey} />}
        {tab === 'solicitar' && <SolicitarTab storeId={storeId} qs={qs} notify={notify} />}
        {tab === 'buscar' && <BuscarPagosTab storeId={storeId} qs={qs} admin={admin} notify={notify} />}
        {tab === 'reembolso' && <SolicitarReembolsoTab storeId={storeId} qs={qs} notify={notify} />}
      </motion.div>
    </AnimatePresence>
  )

  // Barra de pestañas (compartida entre modo tienda y modo espejo del admin)
  const tabBar = (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map(t => {
        const active = tab === t.key
        return (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-all"
            style={{
              background: active ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? 'rgba(0,212,255,0.4)' : 'rgba(148,163,184,0.12)'}`,
              color: active ? '#00d4ff' : 'rgba(148,163,184,0.75)',
              boxShadow: active ? '0 0 16px rgba(0,212,255,0.12)' : 'none',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )

  // Modo espejo (admin): sin header ni fondo — se embebe dentro de /finanzas.
  if (admin) {
    return (
      <div className="space-y-4">
        {tabBar}
        {content}
        <ToastStack toasts={toasts} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% -10%, #0a1628 0%, #060b14 55%)' }}>
      {/* Header (grid 3 columnas, igual estética que la app principal) */}
      <header className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 items-center gap-2 sm:gap-4"
          style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
          {/* LEFT: usuario */}
          <div className="flex items-center gap-2">
            <div ref={userMenuRef} className="relative flex items-center">
              <button
                onClick={() => setUserMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full transition-all"
                style={{
                  background: 'linear-gradient(135deg, #00d4ff22, #0070f322)',
                  border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff',
                  boxShadow: userMenuOpen ? '0 0 14px rgba(0,212,255,0.25)' : 'none',
                }}
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
                  <Link
                    href="/notificaciones"
                    className="w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-2"
                    style={{ color: 'rgba(226,232,240,0.9)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>🔔</span> Notificaciones
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-2"
                    style={{ color: '#f87171' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>→</span> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* CENTER: logo */}
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CriptoBlue" className="h-11 w-11 sm:h-16 sm:w-16 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5), 0 0 48px rgba(0,212,255,0.15)' }} />
            {/* En móvil se oculta: al ir en la columna `auto` del grid se llevaba 181px
                de los 343 y le dejaba solo 73px al nombre de la tienda, que se cortaba. */}
            <span className="hidden sm:inline text-[9px] sm:text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.8)', letterSpacing: '0.12em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}>
              Automatización de Procesos
            </span>
          </div>

          {/* RIGHT: nombre de la tienda */}
          <div className="flex items-center justify-end gap-2 min-w-0">
            <div className="text-right min-w-0">
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.5)' }}>Tienda</div>
              <div className="text-xs sm:text-sm font-bold truncate" style={{ color: '#00d4ff', textShadow: '0 0 12px rgba(0,212,255,0.3)' }}>{storeName}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6 space-y-5">
        {tabBar}
        {content}
      </main>

      <ToastStack toasts={toasts} />
    </div>
  )
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="px-4 py-3 rounded-xl text-sm max-w-xs shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #0d1117, #111827)',
              border: `1px solid ${t.type === 'error' ? 'rgba(248,113,113,0.4)' : t.type === 'success' ? 'rgba(0,255,136,0.4)' : 'rgba(0,212,255,0.3)'}`,
              color: t.type === 'error' ? '#f87171' : t.type === 'success' ? '#00ff88' : '#00d4ff',
            }}
          >
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
