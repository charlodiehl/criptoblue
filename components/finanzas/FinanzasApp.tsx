'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ARS } from '@/lib/utils'
import TiendaPortal from '@/components/tienda/TiendaPortal'
import AdminGeneralTab from './AdminGeneralTab'

export type Toast = { id: number; msg: string; type: 'success' | 'error' | 'info' }
export interface BalanceCard { storeId: string; storeName: string; ars: number; usdt: number; pendientes: number }

const fmtUsdt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function FinanzasApp({ userEmail }: { userEmail?: string }) {
  const [cards, setCards] = useState<BalanceCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [active, setActive] = useState<'general' | string>('general')  // 'general' o storeId
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const notify = useCallback((msg: string, type: Toast['type'] = 'info') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  const fetchBalances = useCallback(async () => {
    try {
      const res = await fetch('/api/finanzas/balances')
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      const data = await res.json()
      setCards(data.cards || [])
    } catch (e) {
      notify(`No se pudieron cargar los balances: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoadingCards(false)
    }
  }, [notify])

  // Carga inicial + refresco cada 60s (los balances cambian al pagar solicitudes / emparejar)
  useEffect(() => {
    fetchBalances()
    const iv = setInterval(fetchBalances, 60_000)
    return () => clearInterval(iv)
  }, [fetchBalances])

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

  const activeStore = active !== 'general' ? cards.find(c => c.storeId === active) : null

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% -10%, #0a1628 0%, #060b14 55%)' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div className="mx-auto max-w-[1600px] px-6 py-3 items-center gap-4"
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
                <div className="absolute left-0 mt-2 w-56 rounded-xl overflow-hidden z-50"
                  style={{ top: '100%', background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                  {userEmail && (
                    <div className="px-4 py-3 text-xs" style={{ color: 'rgba(148,163,184,0.7)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                      <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'rgba(0,212,255,0.55)' }}>Administrador</div>
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

          {/* CENTER: logo + título de sección */}
          <div className="flex flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CriptoBlue" className="h-14 w-14 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5)' }} />
            <span className="text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.85)', letterSpacing: '0.16em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}>
              Administración Financiera
            </span>
          </div>

          {/* RIGHT: volver a la gestión de órdenes */}
          <div className="flex items-center justify-end">
            <Link href="/" className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all"
              style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)', color: '#00d4ff' }}>
              ← Gestión de órdenes
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-5">
        {/* Franja de tarjetas de balance por tienda */}
        <div className="flex flex-wrap gap-3 mb-5">
          {loadingCards ? (
            <div className="text-sm py-4" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando balances…</div>
          ) : cards.length === 0 ? (
            <div className="text-sm py-4" style={{ color: 'rgba(148,163,184,0.5)' }}>No hay tiendas conectadas.</div>
          ) : (
            cards.map(c => (
              <button key={c.storeId} onClick={() => setActive(c.storeId)}
                className="rounded-2xl p-4 text-left transition-all min-w-[190px] flex-1"
                style={{
                  background: 'linear-gradient(135deg, #0d1117, #111827)',
                  border: `1px solid ${active === c.storeId ? 'rgba(0,212,255,0.5)' : 'rgba(0,212,255,0.14)'}`,
                  boxShadow: active === c.storeId ? '0 0 18px rgba(0,212,255,0.12)' : 'none', cursor: 'pointer',
                }}>
                <div className="text-xs font-semibold truncate mb-2" style={{ color: 'rgba(226,232,240,0.85)' }}>{c.storeName}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-black" style={{ color: '#00d4ff' }}>{fmtUsdt(c.usdt)}</span>
                  <span className="text-[10px] font-bold" style={{ color: 'rgba(0,212,255,0.6)' }}>USDT</span>
                </div>
                <div className="text-sm font-bold mt-0.5" style={{ color: '#00ff88' }}>{ARS.format(c.ars)}</div>
                {c.pendientes > 0 && <div className="text-[10px] mt-1" style={{ color: '#fbbf24' }}>{c.pendientes} sin cotización</div>}
              </button>
            ))
          )}
        </div>

        {/* Menú lateral + panel */}
        <div className="flex gap-5 items-start">
          <aside className="shrink-0 w-56 space-y-1.5">
            <SideItem label="Administración general" active={active === 'general'} onClick={() => setActive('general')} />
            <div className="text-[10px] uppercase tracking-widest px-3 pt-3 pb-1" style={{ color: 'rgba(148,163,184,0.4)' }}>Tiendas</div>
            {cards.map(c => (
              <SideItem key={c.storeId} label={c.storeName} active={active === c.storeId} onClick={() => setActive(c.storeId)} />
            ))}
          </aside>

          <main className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {active === 'general' ? (
                  <AdminGeneralTab notify={notify} onSolicitudPagada={fetchBalances} />
                ) : activeStore ? (
                  <div className="space-y-4">
                    <h2 className="text-lg font-bold" style={{ color: '#00d4ff' }}>{activeStore.storeName}</h2>
                    <p className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>Vista espejo — mismas funciones que la tienda (control y operación).</p>
                    <TiendaPortal storeId={activeStore.storeId} storeName={activeStore.storeName} admin />
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
    <button onClick={onClick} className="w-full text-left rounded-xl px-3 py-2.5 text-sm font-medium transition-all truncate"
      style={{
        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
        border: `1px solid ${active ? 'rgba(0,212,255,0.35)' : 'transparent'}`,
        color: active ? '#00d4ff' : 'rgba(148,163,184,0.8)',
      }}>
      {label}
    </button>
  )
}
