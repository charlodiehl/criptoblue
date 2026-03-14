'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import StatsBar from '@/components/StatsBar'
import ManualMatchTab from '@/components/ManualMatchTab'
import OrdersListTab from '@/components/OrdersListTab'
import PaymentsListTab from '@/components/PaymentsListTab'
import RegistroTab from '@/components/RegistroTab'
import type { Order, UnmatchedPayment, Store, LogEntry, Payment, RecentMatch } from '@/lib/types'

type Tab = 'manual' | 'ordenes' | 'pagos' | 'sin-coincidencia' | 'registro'

interface Stats {
  paidThisMonth: number
  paidVolumeThisMonth: number
  pendingOrders: number
  pendingPayments: number
  lastMPCheck: string | null
  externallyMarkedOrders: string[]
  externallyMarkedPayments: string[]
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

export default function Dashboard() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('manual')
  const [stats, setStats] = useState<Stats | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [unmatchedPayments, setUnmatchedPayments] = useState<UnmatchedPayment[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [actionLoading, setActionLoading] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([])
  const [matchRefreshKey, setMatchRefreshKey] = useState(0)
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
      if (res.ok) {
        const data = await res.json()
        // Soporte nuevo formato { entries, recentMatches }
        if (Array.isArray(data)) {
          setLogEntries(data)
        } else {
          setLogEntries(data.entries || [])
          setRecentMatches(data.recentMatches || [])
        }
      }
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
    fetchUnmatched()
    fetchStores()
  }, [fetchStatus, fetchUnmatched, fetchStores])

  // Poll status every 5 seconds (no fetchStores — el dropdown no debe actualizarse solo)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Load orders/payments when tab is shown
  useEffect(() => {
    if (tab === 'manual' || tab === 'ordenes') {
      fetchOrders()
    }
    if (tab === 'manual' || tab === 'pagos' || tab === 'sin-coincidencia') {
      fetchUnmatched()
    }
    if (tab === 'registro' || tab === 'pagos' || tab === 'sin-coincidencia') {
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
        await fetchStatus()
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setDeletingStore(null)
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

  const handleManualMatch = async (mpPaymentId: string, orderId: string, storeId: string, order?: Order) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId, orderId, storeId, order }),
      })
      const data = await res.json()
      if (data.success) {
        if (data.method === 'note') {
          addToast('Pago registrado — TiendaNube no permite cambiar el estado vía API, se agregó una nota a la orden. Marcalo manualmente en TN.', 'error')
        } else {
          addToast('Orden marcada como pagada en TiendaNube', 'success')
        }
        // Actualización local instantánea — sin recargar todo desde el servidor
        setUnmatchedPayments(prev => prev.filter(u => (u.mpPaymentId || u.payment.mpPaymentId) !== mpPaymentId))
        if (data.logEntry) setLogEntries(prev => [...prev, data.logEntry])
        if (data.recentMatch) setRecentMatches(prev => [...prev, data.recentMatch])
        setStats(prev => prev ? {
          ...prev,
          paidThisMonth: prev.paidThisMonth + 1,
          paidVolumeThisMonth: prev.paidVolumeThisMonth + (data.logEntry?.amount ?? 0),
          pendingOrders: Math.max(0, prev.pendingOrders - 1),
        } : prev)
        setMatchRefreshKey(k => k + 1)
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelDuplicate = async (storeId: string, orderId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Orden duplicada descartada de la app', 'success')
        await fetchOrders()
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

  const handleReevaluar = async () => {
    setMatchRefreshKey(k => k + 1)
    setActionLoading(true)
    try {
      const res = await fetch('/api/reevaluar', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const parts = [`${data.processed} pagos nuevos`]
        if (data.cancelled > 0) parts.push(`${data.cancelled} órdenes abandonadas canceladas`)
        addToast(`Actualizado: ${parts.join(' · ')}`, 'success')
        await Promise.all([fetchUnmatched(), fetchOrders(), fetchStatus()])
      } else {
        addToast(`Error al reevaluar: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleMarkPaymentReceived = async (mpPaymentId: string) => {
    try {
      const res = await fetch('/api/mark-payment-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Pago marcado como recibido', 'success')
        // Actualización optimista: verde inmediato sin esperar fetchStatus
        setStats(prev => prev ? {
          ...prev,
          externallyMarkedPayments: [...(prev.externallyMarkedPayments ?? []), mpPaymentId],
        } : prev)
        fetchStatus() // background sync, sin await
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    }
  }

  const handleMarkOrderExternal = async (orderId: string, storeId: string) => {
    try {
      const res = await fetch('/api/mark-order-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, storeId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Orden marcada como gestionada externamente', 'success')
        // Actualización optimista: verde inmediato sin esperar fetchStatus
        const key = `${storeId}-${orderId}`
        setStats(prev => prev ? {
          ...prev,
          externallyMarkedOrders: [...(prev.externallyMarkedOrders ?? []), key],
        } : prev)
        fetchStatus() // background sync, sin await
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    }
  }

  const handleClearLog = async () => {
    try {
      const res = await fetch('/api/log', { method: 'DELETE' })
      if (res.ok) {
        setLogEntries([])
        addToast('Registro borrado', 'success')
      }
    } catch { /* ignore */ }
  }

  const HOURS_24 = 24 * 60 * 60 * 1000
  const HOURS_48 = 48 * 60 * 60 * 1000

  // Todas las órdenes de las últimas 48hs (pendientes + pagadas desde log + fallback desde recentMatches)
  const allRecentOrders = useMemo((): Order[] => {
    const now = Date.now()
    const pendingMap = new Map(orders.map(o => [`${o.storeId}-${o.orderId}`, o]))
    const seenIds = new Set<string>()

    const fromLog: Order[] = logEntries
      .filter(e =>
        (e.action === 'auto_paid' || e.action === 'manual_paid') &&
        e.orderId && e.storeId &&
        (now - new Date(e.timestamp).getTime()) <= HOURS_48
      )
      .map(e => e.order ?? ({
        orderId: e.orderId!,
        orderNumber: e.orderNumber || '',
        total: e.amount || 0,
        customerName: e.customerName || '',
        customerEmail: '',
        customerCuit: '',
        createdAt: e.timestamp,
        gateway: '',
        storeId: e.storeId!,
        storeName: e.storeName || '',
      } as Order))
      .filter(o => {
        const key = `${o.storeId}-${o.orderId}`
        if (pendingMap.has(key) || seenIds.has(key)) return false
        seenIds.add(key)
        return true
      })

    // Fallback: órdenes desde recentMatches cuando el log fue borrado
    const fromRecent: Order[] = recentMatches
      .filter(m => m.order && m.orderId && m.storeId &&
        (now - new Date(m.matchedAt).getTime()) <= HOURS_48)
      .map(m => m.order!)
      .filter(o => {
        const key = `${o.storeId}-${o.orderId}`
        if (pendingMap.has(key) || seenIds.has(key)) return false
        seenIds.add(key)
        return true
      })

    return [...orders, ...fromLog, ...fromRecent]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [orders, logEntries, recentMatches, HOURS_48])

  // Todos los pagos de las últimas 24hs (macheados + no macheados)
  const allRecentPayments = useMemo((): Payment[] => {
    const now = Date.now()
    const seenIds = new Set<string>()

    // Pagos macheados del registro (últimas 24hs)
    const fromLog = logEntries
      .filter(e => (e.action === 'auto_paid' || e.action === 'manual_paid') && e.payment &&
        (now - new Date(e.timestamp).getTime()) <= HOURS_24)
      .map(e => e.payment!)
      .filter(p => { if (seenIds.has(p.mpPaymentId)) return false; seenIds.add(p.mpPaymentId); return true })

    // Fallback: pagos desde recentMatches cuando el log fue borrado
    const fromRecent = recentMatches
      .filter(m => m.payment && (now - new Date(m.matchedAt).getTime()) <= HOURS_24)
      .map(m => m.payment!)
      .filter(p => { if (seenIds.has(p.mpPaymentId)) return false; seenIds.add(p.mpPaymentId); return true })

    // Pagos no macheados (últimas 24hs)
    const unmatched = unmatchedPayments
      .filter(u => (now - new Date(u.payment.fechaPago).getTime()) <= HOURS_24)
      .map(u => u.payment)
      .filter(p => !seenIds.has(p.mpPaymentId))

    return [...fromLog, ...fromRecent, ...unmatched]
  }, [unmatchedPayments, logEntries, recentMatches, HOURS_24])

  // IDs de pagos y órdenes ya macheados (para resaltar en verde en las pestañas)
  // Usan recentMatches (auto-limpia a 24h) para ser independientes del borrado manual del Registro
  const matchedPaymentIds = useMemo(() => new Set([
    ...recentMatches.map(m => m.mpPaymentId).filter(Boolean) as string[],
    ...(stats?.externallyMarkedPayments ?? []),
  ]), [recentMatches, stats?.externallyMarkedPayments])

  const matchedOrderIds = useMemo(() => new Set([
    ...recentMatches.filter(m => m.orderId && m.storeId).map(m => `${m.storeId}-${m.orderId}`),
    ...(stats?.externallyMarkedOrders ?? []),
  ]), [recentMatches, stats?.externallyMarkedOrders])

  // Pagos de las últimas 24hs sin coincidencia con ninguna orden
  const paymentsWithoutMatch = useMemo((): Payment[] => {
    const now = Date.now()
    return unmatchedPayments
      .filter(u => (now - new Date(u.payment.fechaPago).getTime()) <= HOURS_24)
      .map(u => u.payment)
      .filter(p => !matchedPaymentIds.has(p.mpPaymentId))
  }, [unmatchedPayments, matchedPaymentIds, HOURS_24])

  // Cuenta pares potenciales: pagos con ≥2 señales coincidentes con alguna orden
  const pendingPairsCount = useMemo(() => {
    return unmatchedPayments.filter(u => {
      return orders.some(o => {
        const payTime = u.payment.fechaPago ? new Date(u.payment.fechaPago).getTime() : null
        const ordTime = o.createdAt ? new Date(o.createdAt).getTime() : null
        if (payTime && ordTime && payTime < ordTime) return false
        let matches = 0
        if (Math.abs(u.payment.monto - o.total) / Math.max(o.total, 1) < 0.02) matches++
        if (payTime && ordTime) {
          const diffMin = (payTime - ordTime) / 60000
          if (diffMin >= 0 && diffMin <= 1440) matches++
        }
        if (u.payment.nombrePagador && o.customerName) {
          const a = u.payment.nombrePagador.toLowerCase().split(/\s+/)
          const b = o.customerName.toLowerCase().split(/\s+/)
          if (a.some(t => t.length > 2 && b.includes(t))) matches++
        }
        if (u.payment.emailPagador && o.customerEmail &&
            u.payment.emailPagador.toLowerCase() === o.customerEmail.toLowerCase()) matches++
        return matches >= 2
      })
    }).length
  }, [unmatchedPayments, orders])

  const tabs: { id: Tab; label: string; primary?: boolean }[] = [
    { id: 'manual', label: 'Emparejamiento', primary: true },
    { id: 'ordenes', label: `Órdenes (${allRecentOrders.length})` },
    { id: 'pagos', label: `Pagos (${allRecentPayments.length})` },
    { id: 'sin-coincidencia', label: `Sin coincidencia (${paymentsWithoutMatch.length})` },
    { id: 'registro', label: 'Registro' },
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

          {/* RIGHT: Sync info + Actualizar + Tiendas dropdown */}
          <div className="flex items-center justify-end gap-2">
            {actionLoading ? (
              <span style={{ fontSize: '11px', color: '#00d4ff', whiteSpace: 'nowrap', opacity: 0.7 }}>
                ⟳ Sincronizando...
              </span>
            ) : stats?.lastMPCheck ? (
              <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', whiteSpace: 'nowrap' }}>
                Sync: {new Date(stats.lastMPCheck).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <button
              onClick={handleReevaluar}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all disabled:opacity-50"
              style={{
                background: 'rgba(0,212,255,0.08)',
                border: '1px solid rgba(0,212,255,0.25)',
                color: '#00d4ff',
              }}
            >
              {actionLoading ? '...' : '↻ Actualizar'}
            </button>
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
        <StatsBar stats={stats} pendingPairs={pendingPairsCount} ordersCount={orders.length} />

        {/* Tabs */}
        <div className="flex gap-4 overflow-x-auto pb-1">
          {tabs.map(t => {
            const isActive = tab === t.id
            const isPrimary = t.primary
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="whitespace-nowrap transition-all"
                style={{
                  padding: isPrimary ? '11px 28px' : '10px 22px',
                  borderRadius: '12px',
                  fontSize: isPrimary ? '14px' : '13px',
                  fontWeight: isPrimary ? 700 : 500,
                  letterSpacing: isPrimary ? '0.02em' : '0.04em',
                  border: isActive
                    ? isPrimary
                      ? '1px solid rgba(0,212,255,0.45)'
                      : '1px solid rgba(0,212,255,0.25)'
                    : isPrimary
                    ? '1px solid rgba(0,212,255,0.2)'
                    : '1px solid rgba(255,255,255,0.07)',
                  background: isActive
                    ? isPrimary
                      ? 'linear-gradient(135deg, rgba(0,212,255,0.12), rgba(0,112,243,0.08))'
                      : 'rgba(0,212,255,0.07)'
                    : isPrimary
                    ? 'rgba(0,212,255,0.05)'
                    : 'rgba(255,255,255,0.03)',
                  color: isActive
                    ? isPrimary ? '#00d4ff' : 'rgba(0,212,255,0.85)'
                    : isPrimary
                    ? 'rgba(0,212,255,0.55)'
                    : 'rgba(148,163,184,0.5)',
                  boxShadow: isActive && isPrimary
                    ? '0 0 18px rgba(0,212,255,0.15), inset 0 0 12px rgba(0,212,255,0.04)'
                    : isActive
                    ? '0 0 10px rgba(0,212,255,0.08)'
                    : 'none',
                  textShadow: isActive && isPrimary ? '0 0 16px rgba(0,212,255,0.5)' : 'none',
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div>
          {tab === 'manual' && <ManualMatchTab unmatchedPayments={unmatchedPayments} orders={orders.filter(o => !matchedOrderIds.has(`${o.storeId}-${o.orderId}`))} onManualMatch={handleManualMatch} onDismissPayment={handleDismissPayment} onMarkOrderPaid={handleMarkOrderPaid} onCancelDuplicate={handleCancelDuplicate} loading={actionLoading} lastMPCheck={stats?.lastMPCheck ?? null} refreshKey={matchRefreshKey} />}
          {tab === 'ordenes' && <OrdersListTab orders={allRecentOrders} matchedIds={matchedOrderIds} onMarkExternal={handleMarkOrderExternal} loading={actionLoading} />}
          {tab === 'pagos' && <PaymentsListTab payments={allRecentPayments} matchedIds={matchedPaymentIds} title="Pagos · últimas 24hs" emptyText="No hay pagos en las últimas 24 horas" onMarkReceived={handleMarkPaymentReceived} loading={actionLoading} />}
          {tab === 'sin-coincidencia' && <PaymentsListTab payments={paymentsWithoutMatch} title="Pagos sin coincidencia · últimas 24hs" emptyText="Todos los pagos de las últimas 24hs tienen una orden asignada" onMarkReceived={handleMarkPaymentReceived} loading={actionLoading} />}
          {tab === 'registro' && <RegistroTab entries={logEntries} onClearLog={handleClearLog} />}
        </div>
      </main>
    </div>
  )
}
