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
import type { PendingMatch, Order, LogEntry, UnmatchedPayment } from '@/lib/types'

type Tab = 'transferencias' | 'pedidos' | 'match' | 'manual' | 'cancelaciones'

interface Stats {
  pendingMatch: number
  manualPaid: number
  noMatch: number
  totalAmount: number
  processedPayments: number
  lastMPCheck?: string
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

function fmtDate(iso: string) {
  if (!iso) return null
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
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
  const [running, setRunning] = useState(false)
  const [matchLoading, setMatchLoading] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const toastIdRef = useRef(0)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
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

  // Initial loads
  useEffect(() => {
    fetchStatus()
    fetchPendingMatches()
    fetchUnmatched()
  }, [fetchStatus, fetchPendingMatches, fetchUnmatched])

  // Poll every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus()
      fetchPendingMatches()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchPendingMatches])

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


  const runCycle = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/run', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        addToast(`Ciclo completado: ${data.autoPaid} pagados, ${data.needsReview} en revisión, ${data.noMatch} sin match`, 'success')
        await Promise.all([fetchStatus(), fetchPendingMatches(), fetchUnmatched()])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error de red: ${err}`, 'error')
    } finally {
      setRunning(false)
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
      <header className="sticky top-0 z-40 backdrop-blur-xl relative"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.85)' }}>
        <div className="mx-auto max-w-[1400px] px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="CriptoBlue" className="h-10 w-10 rounded-xl object-cover"
              style={{ boxShadow: '0 0 16px rgba(0,212,255,0.35)' }} />
            <div>
              <h1 className="text-base font-bold text-white leading-tight">CriptoBlue</h1>
              <p className="text-xs leading-tight" style={{ color: 'rgba(0,212,255,0.5)' }}>Conciliación MP · TiendaNube</p>
            </div>

            {/* User avatar dropdown */}
            <div ref={userMenuRef} className="relative ml-2">
              <button
                onClick={() => setUserMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg, #00d4ff22, #0070f322)',
                  border: '1px solid rgba(0,212,255,0.3)',
                  color: '#00d4ff',
                  boxShadow: userMenuOpen ? '0 0 14px rgba(0,212,255,0.25)' : 'none',
                }}
              >
                B
              </button>
              {userMenuOpen && (
                <div
                  className="absolute left-0 mt-2 w-44 rounded-xl overflow-hidden z-50"
                  style={{
                    background: 'linear-gradient(135deg, #0d1117, #111827)',
                    border: '1px solid rgba(0,212,255,0.15)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}
                >
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
                    <p className="text-xs font-semibold text-white">Benancio</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(0,212,255,0.5)' }}>Administrador</p>
                  </div>
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

          <div className="flex items-center gap-3">
            {stats?.lastMPCheck && (
              <p className="text-xs hidden sm:block" style={{ color: 'rgba(148,163,184,0.5)' }}>
                Último ciclo: {fmtDate(stats.lastMPCheck)}
              </p>
            )}
            <a href="/tiendas"
              className="hidden sm:flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.8)' }}>
              🏪 Tiendas
            </a>
            <button
              onClick={runCycle}
              disabled={running}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all"
              style={{
                background: running ? 'rgba(0,212,255,0.08)' : 'linear-gradient(135deg, #00d4ff, #0070f3)',
                boxShadow: running ? 'none' : '0 0 20px rgba(0,212,255,0.3)',
                color: running ? '#00d4ff' : 'white',
                border: '1px solid rgba(0,212,255,0.3)',
                cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              <span className={running ? 'animate-spin' : ''}>⚡</span>
              {running ? 'Procesando...' : 'Correr ciclo MP'}
            </button>
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
