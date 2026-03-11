'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import StatsBar from '@/components/StatsBar'
import MatchTable from '@/components/MatchTable'
import ManualMatchTab from '@/components/ManualMatchTab'
import TransferenciasTable from '@/components/TransferenciasTable'
import OrdersTable from '@/components/OrdersTable'
import CancelacionesTable from '@/components/CancelacionesTable'
import ActivityLog from '@/components/ActivityLog'
import type { PendingMatch, Order, LogEntry, UnmatchedPayment, Store } from '@/lib/types'

type Tab = 'transferencias' | 'pedidos' | 'match' | 'manual' | 'cancelaciones'

interface Stats {
  paidThisMonth: number
  paidVolumeThisMonth: number
  pendingOrders: number
  pendingPayments: number
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

export default function Dashboard() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('match')
  const [stats, setStats] = useState<Stats | null>(null)
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [unmatchedPayments, setUnmatchedPayments] = useState<UnmatchedPayment[]>([])
  const [matchLog, setMatchLog] = useState<LogEntry[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [matchLoading, setMatchLoading] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const toastIdRef = useRef(0)

  // User menu
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Stores dropdown
  const [stores, setStores] = useState<Store[]>([])
  const [storesOpen, setStoresOpen] = useState(false)
  const [storesLoading, setStoresLoading] = useState(false)
  const [deletingStore, setDeletingStore] = useState<string | null>(null)
  const storesMenuRef = useRef<HTMLDivElement>(null)

  // Click-outside handlers
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
      if (storesMenuRef.current && !storesMenuRef.current.contains(e.target as Node)) {
        setStoresOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
  }

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchPendingMatches = useCallback(async () => {
    try {
      const res = await fetch('/api/pending-matches')
      if (res.ok) setPendingMatches(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchUnmatched = useCallback(async () => {
    try {
      const res = await fetch('/api/unmatched-payments')
      if (res.ok) setUnmatchedPayments(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders')
      if (res.ok) setOrders(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch('/api/log')
      if (res.ok) setMatchLog(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchStores = useCallback(async () => {
    setStoresLoading(true)
    try {
      const res = await fetch('/api/stores')
      if (res.ok) setStores(await res.json())
    } catch { /* ignore */ } finally {
      setStoresLoading(false)
    }
  }, [])

  // Initial loads
  useEffect(() => {
    fetchStatus()
    fetchPendingMatches()
    fetchUnmatched()
    fetchStores()
  }, [fetchStatus, fetchPendingMatches, fetchUnmatched, fetchStores])


  // Poll every 5 seconds (incluye tiendas para detectar nueva conexión desde otra pestaña)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus()
      fetchPendingMatches()
      fetchStores()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchPendingMatches, fetchStores])

  // Load orders when tab is shown
  useEffect(() => {
    if (tab === 'pedidos' || tab === 'cancelaciones' || tab === 'manual') {
      fetchOrders()
    }
    if (tab === 'manual') {
      fetchUnmatched()
    }
    if (tab === 'transferencias') {
      fetchLog()
    }
  }, [tab, fetchOrders, fetchUnmatched, fetchLog])

  const handleDeleteStore = async (storeId: string, storeName: string) => {
    if (!confirm(`¿Eliminar "${storeName}"? Se borrarán todas sus órdenes del registro.`)) return
    setDeletingStore(storeId)
    try {
      const res = await fetch('/api/stores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast(`Tienda "${storeName}" eliminada`, 'success')
        setStores(prev => prev.filter(s => s.storeId !== storeId))
        await Promise.all([fetchPendingMatches(), fetchStatus()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setDeletingStore(null)
    }
  }

  const handleApprove = async (mpPaymentId: string) => {
    setMatchLoading(mpPaymentId)
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Pago aprobado correctamente', 'success')
        await Promise.all([fetchPendingMatches(), fetchStatus()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setMatchLoading(null)
    }
  }

  const handleDismiss = async (mpPaymentId: string) => {
    setMatchLoading(mpPaymentId)
    try {
      const res = await fetch('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Match descartado', 'success')
        await fetchPendingMatches()
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setMatchLoading(null)
    }
  }

  const handleMarkOrderPaid = async (storeId: string, orderId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/mark-order-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Orden marcada como pagada', 'success')
        await Promise.all([fetchOrders(), fetchStatus()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelOrder = async (storeId: string, orderId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Orden cancelada', 'success')
        await Promise.all([fetchOrders(), fetchStatus()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleManualMatch = async (mpPaymentId: string, orderId: string, storeId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId, orderId, storeId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Match manual confirmado', 'success')
        await Promise.all([fetchUnmatched(), fetchOrders(), fetchStatus()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDismissPayment = async (mpPaymentId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Pago eliminado', 'success')
        await fetchUnmatched()
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'match', label: 'Match', badge: pendingMatches.length },
    { id: 'transferencias', label: 'Transferencias' },
    { id: 'pedidos', label: 'Pedidos' },
    { id: 'manual', label: 'Match Manual', badge: unmatchedPayments.length },
    { id: 'cancelaciones', label: 'Cancelaciones' },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#060b14' }}>
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #0070f3, transparent 70%)', filter: 'blur(100px)' }} />
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(rgba(0,212,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,1) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
      </div>

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className="rounded-xl px-4 py-3 text-sm font-medium shadow-2xl max-w-xs"
            style={t.type === 'success'
              ? { background: 'linear-gradient(135deg,#0d2b1a,#0d1117)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88', boxShadow: '0 0 20px rgba(0,255,136,0.15)' }
              : { background: 'linear-gradient(135deg,#2b0d0d,#0d1117)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', boxShadow: '0 0 20px rgba(248,113,113,0.15)' }
            }
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div
          className="mx-auto max-w-[1400px] px-6 py-3 items-center gap-4"
          style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}
        >
          {/* LEFT: User avatar */}
          <div ref={userMenuRef} className="relative flex items-center">
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className="flex items-center justify-center w-9 h-9 rounded-full transition-all"
              style={{
                background: 'linear-gradient(135deg, #00d4ff22, #0070f322)',
                border: '1px solid rgba(0,212,255,0.3)',
                color: '#00d4ff',
                boxShadow: userMenuOpen ? '0 0 14px rgba(0,212,255,0.25)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
              </svg>
            </button>
            {userMenuOpen && (
              <div
                className="absolute left-0 mt-2 w-40 rounded-xl overflow-hidden z-50"
                style={{
                  top: '100%',
                  background: 'linear-gradient(135deg, #0d1117, #111827)',
                  border: '1px solid rgba(0,212,255,0.15)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
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

          {/* CENTER: Logo + subtitle */}
          <div className="flex flex-col items-center gap-1.5">
            <img
              src="/logo.png"
              alt="CriptoBlue"
              className="h-20 w-20 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5), 0 0 48px rgba(0,212,255,0.15)' }}
            />
            <span
              className="text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.8)', letterSpacing: '0.18em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}
            >
              Automatización de Procesos
            </span>
          </div>

          {/* RIGHT: Tiendas dropdown */}
          <div className="flex items-center justify-end">
            <div ref={storesMenuRef} className="relative">
              <button
                onClick={() => { setStoresOpen(v => !v); if (!storesOpen) fetchStores() }}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all"
                style={{
                  background: storesOpen ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(0,212,255,0.2)',
                  color: 'rgba(148,163,184,0.9)',
                  boxShadow: storesOpen ? '0 0 16px rgba(0,212,255,0.1)' : 'none',
                }}
              >
                🏪 Tiendas
                <span style={{ color: 'rgba(0,212,255,0.5)', fontSize: '10px', marginLeft: '2px' }}>
                  {storesOpen ? '▲' : '▼'}
                </span>
              </button>

              {storesOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-xl overflow-hidden z-50"
                  style={{
                    background: 'linear-gradient(135deg, #0d1117, #111827)',
                    border: '1px solid rgba(0,212,255,0.15)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                  }}
                >
                  {/* Header del dropdown */}
                  <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'rgba(0,212,255,0.6)' }}>
                      Tiendas conectadas
                    </p>
                  </div>

                  {/* Lista de tiendas */}
                  {storesLoading ? (
                    <div className="px-4 py-4 text-xs text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>
                      Cargando...
                    </div>
                  ) : stores.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>
                      No hay tiendas conectadas
                    </div>
                  ) : (
                    <div>
                      {stores.map(store => (
                        <div
                          key={store.storeId}
                          className="w-full px-4 py-3 text-sm flex items-center justify-between group"
                          style={{ borderBottom: '1px solid rgba(0,212,255,0.05)' }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: '#00ff88', boxShadow: '0 0 6px rgba(0,255,136,0.6)' }} />
                            <span className="text-sm text-white truncate">{store.storeName}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteStore(store.storeId, store.storeName)}
                            disabled={deletingStore === store.storeId}
                            className="text-xs flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 cursor-pointer"
                            style={{ color: '#f87171' }}
                          >
                            {deletingStore === store.storeId ? '...' : '✕ eliminar'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Botón agregar tienda */}
                  <div className="p-3" style={{ borderTop: stores.length > 0 ? '1px solid rgba(0,212,255,0.08)' : 'none' }}>
                    <button
                      onClick={() => {
                        setStoresOpen(false)
                        window.open('/api/tn/connect', '_blank', 'noopener,noreferrer')
                      }}
                      className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #00c851, #00a844)',
                        color: 'white',
                        boxShadow: '0 0 16px rgba(0,200,81,0.25)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 24px rgba(0,200,81,0.4)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 16px rgba(0,200,81,0.25)')}
                    >
                      <span className="text-base font-bold">+</span>
                      Agregar tienda
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1400px] px-6 py-6 space-y-6">
        <StatsBar stats={stats} />

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
          <div className="flex gap-1 overflow-x-auto pb-px">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium transition-all relative"
                style={{
                  color: tab === t.id ? '#00d4ff' : 'rgba(148,163,184,0.6)',
                  borderBottom: tab === t.id ? '2px solid #00d4ff' : '2px solid transparent',
                  textShadow: tab === t.id ? '0 0 12px rgba(0,212,255,0.6)' : 'none',
                }}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="rounded-full px-1.5 py-0.5 text-xs font-bold"
                    style={tab === t.id
                      ? { background: 'rgba(0,212,255,0.15)', color: '#00d4ff' }
                      : { background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.7)' }
                    }>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div>
          {tab === 'match' && <MatchTable matches={pendingMatches} onApprove={handleApprove} onDismiss={handleDismiss} loading={matchLoading} />}
          {tab === 'transferencias' && <TransferenciasTable entries={matchLog} />}
          {tab === 'pedidos' && <OrdersTable orders={orders} onMarkPaid={handleMarkOrderPaid} onCancel={handleCancelOrder} loading={actionLoading} />}
          {tab === 'manual' && <ManualMatchTab unmatchedPayments={unmatchedPayments} orders={orders} onManualMatch={handleManualMatch} onDismissPayment={handleDismissPayment} onMarkOrderPaid={handleMarkOrderPaid} loading={actionLoading} />}
          {tab === 'cancelaciones' && <CancelacionesTable orders={orders} onCancel={handleCancelOrder} loading={actionLoading} />}
        </div>

        <ActivityLog entries={matchLog} />
      </main>
    </div>
  )
}
