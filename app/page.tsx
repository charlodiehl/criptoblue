'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatsBar from '@/components/StatsBar'
import ManualMatchTab from '@/components/ManualMatchTab'
import OrdersListTab from '@/components/OrdersListTab'
import PaymentsListTab from '@/components/PaymentsListTab'
import RegistroTab from '@/components/RegistroTab'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import type { Order, UnmatchedPayment, Store, LogEntry, Payment, RecentMatch, ErrorEntry } from '@/lib/types'
import { HARD_CUTOFF_PAYMENTS, HARD_CUTOFF_ORDERS, WALLETS_SIN_VENCIMIENTO, esOrdenDeTercero } from '@/lib/config'
import { paymentWalletId } from '@/lib/utils'

type Tab = 'manual' | 'ordenes' | 'pagos' | 'sin-coincidencia' | 'registro' | 'terceros'

interface Stats {
  matchedCount: number        // pagos emparejados desde Emparejamiento (MP real)
  matchedVolume: number       // volumen de emparejados
  manualCount: number         // órdenes marcadas con "Marcar manualmente" (Órdenes tab)
  manualVolume: number        // volumen de marcados manualmente
  pendingOrders: number
  lastMPCheck: string | null
  lastAutoMatchAt?: string | null
  lastAutoMatchMatched?: number
  externallyMarkedOrders: string[]
  externallyMarkedPayments: string[]
  recentMatches?: RecentMatch[]
  currentPhase?: 'idle' | 'syncing' | 'auto-matching'
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
  // Modal de cierre obligatorio cuando un pago se registra pero NO se marca en la tienda
  const [markFailModal, setMarkFailModal] = useState<{ orderNumber?: string; storeName?: string; error?: string } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [systemLocked, setSystemLocked] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logVersion, setLogVersion] = useState(0)
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([])
  const [matchRefreshKey, setMatchRefreshKey] = useState(0)
  const toastIdRef = useRef(0)
  // isRefreshingRef eliminado — ya no hay silentRefresh
  // User menu
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Centro de errores (campana del header)
  const [errores, setErrores] = useState<ErrorEntry[]>([])
  const [erroresNoVistos, setErroresNoVistos] = useState(0)
  const [erroresOpen, setErroresOpen] = useState(false)
  const erroresMenuRef = useRef<HTMLDivElement>(null)

  // Stores dropdown
  const [stores, setStores] = useState<Store[]>([])
  const [storesOpen, setStoresOpen] = useState(false)
  const [platformModalOpen, setPlatformModalOpen] = useState(false)
  const [addStep, setAddStep] = useState<'choose' | 'tn' | 'shopify'>('choose')
  const [copiedLink, setCopiedLink] = useState(false)
  // Shopify: "bala cargada" (una app a la vez, esperando que una tienda la use).
  const [shopifyArmed, setShopifyArmed] = useState<{ clientId: string; shop: string; label: string; armedAt: string } | null>(null)
  const [shopForm, setShopForm] = useState({ shop: '', clientId: '', clientSecret: '', label: '' })
  const [arming, setArming] = useState(false)
  const [dismissedPairs, setDismissedPairs] = useState<{ mpPaymentId: string; orderId: string; storeId: string }[]>([])
  const [storesLoading, setStoresLoading] = useState(false)
  const [deletingStore, setDeletingStore] = useState<string | null>(null)
  const [editingStore, setEditingStore] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [savingStore, setSavingStore] = useState<string | null>(null)
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
      if (erroresMenuRef.current && !erroresMenuRef.current.contains(e.target as Node)) {
        setErroresOpen(false)
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
      if (res.ok) {
        const data = await res.json()
        setStats(data)
        // Sincronizar recentMatches desde status (polled cada 5s) para multi-usuario
        if (data.recentMatches) setRecentMatches(data.recentMatches)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchUnmatched = useCallback(async () => {
    try {
      const res = await fetch('/api/unmatched-payments')
      if (res.ok) setUnmatchedPayments(await res.json())
    } catch { /* ignore */ }
  }, [])

  // fetchSync: reemplaza fetchStatus + fetchUnmatched en el polling — 1 lectura a Supabase en vez de 2
  const lastAutoMatchAtRef = useRef<string | null>(null)

  const fetchSync = useCallback(async () => {
    try {
      const res = await fetch('/api/sync')
      if (res.ok) {
        const data = await res.json()
        setStats({
          matchedCount: data.matchedCount,
          matchedVolume: data.matchedVolume,
          manualCount: data.manualCount,
          manualVolume: data.manualVolume,
          pendingOrders: data.pendingOrders,
          lastMPCheck: data.lastMPCheck,
          lastAutoMatchAt: data.lastAutoMatchAt,
          lastAutoMatchMatched: data.lastAutoMatchMatched,
          externallyMarkedOrders: data.externallyMarkedOrders,
          externallyMarkedPayments: data.externallyMarkedPayments,
          recentMatches: data.recentMatches,
          currentPhase: data.currentPhase ?? 'idle',
        })
        if (data.recentMatches) setRecentMatches(data.recentMatches)
        setUnmatchedPayments(data.unmatchedPayments)

        // Detectar si el cron de auto-match marcó nuevos pares desde el último poll
        const prevAt = lastAutoMatchAtRef.current
        const newAt  = data.lastAutoMatchAt
        if (newAt && newAt !== prevAt && prevAt !== null) {
          const n = data.lastAutoMatchMatched ?? 0
          if (n > 0) {
            addToast(`⚡ Auto-marcado completado · ${n} pago${n !== 1 ? 's' : ''} marcado${n !== 1 ? 's' : ''}`, 'success')
            setMatchRefreshKey(k => k + 1)
            fetchLog()
          }
        }
        lastAutoMatchAtRef.current = newAt ?? prevAt
      }
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
        setLogVersion(v => v + 1)
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

  // Estado de la "bala" de Shopify (app cargada esperando conexión).
  const fetchShopifyArmed = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify/apps')
      if (res.ok) setShopifyArmed((await res.json()).armed || null)
    } catch { /* ignore */ }
  }, [])

  const fetchErrores = useCallback(async () => {
    try {
      const res = await fetch('/api/errores')
      if (res.ok) {
        const data = await res.json()
        setErrores(data.errores || [])
        setErroresNoVistos(data.noVistos || 0)
      }
    } catch { /* ignore */ }
  }, [])

  // Abre la campana y marca las alertas como vistas → baja el badge a 0.
  const handleAbrirErrores = useCallback(async () => {
    const abrir = !erroresOpen
    setErroresOpen(abrir)
    if (abrir && erroresNoVistos > 0) {
      setErroresNoVistos(0) // optimista: el badge baja al instante
      try {
        await fetch('/api/errores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'marcar_vistos' }),
        })
      } catch { /* si falla, el próximo fetch recompone el conteo */ }
    }
  }, [erroresOpen, erroresNoVistos])

  // Carga inicial al montar
  useEffect(() => {
    fetchSync()
    fetchOrders()
    fetchLog()
    fetchStores()
    fetchErrores()
  }, [fetchSync, fetchOrders, fetchLog, fetchStores, fetchErrores])

  // Supabase Realtime — actualización inmediata cuando Supabase notifica un cambio.
  // El errorLog vive en criptoblue:logs → onLogsChange refresca la campana al
  // instante cuando el webhook registra un error (sin sumar polling fijo).
  useRealtimeSync({
    onHotChange: () => {
      setStats(prev => prev ? { ...prev, currentPhase: 'syncing' } : prev)
      fetchSync()
    },
    onLogsChange: () => { fetchLog(); fetchErrores() },
    onOrdersChange: () => fetchOrders(),
    onStoresChange: () => { fetchStores(); fetchShopifyArmed() },
  })

  // Polling de respaldo cada 60s — cubre casos donde Realtime falla o se desconecta
  useEffect(() => {
    const id = setInterval(() => {
      fetchSync()
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchSync])

  // Cargar datos específicos al cambiar de pestaña
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

  // Al abrir el paso de Shopify en "Agregar tienda", traer el estado de la bala.
  useEffect(() => {
    if (platformModalOpen && addStep === 'shopify') fetchShopifyArmed()
  }, [platformModalOpen, addStep, fetchShopifyArmed])

  const handleDeleteStore = async (storeId: string, storeName: string) => {
    if (!confirm(`¿Desconectar "${storeName}"? Se quita de la lista y de gestión financiera. NO se borra el registro general ni el saldo: se conservan y vuelven si la reconectás.`)) return
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

  const handleRenameStore = async (storeId: string) => {
    const nombre = editName.trim()
    if (!nombre) return
    setSavingStore(storeId)
    try {
      const res = await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, storeName: nombre }),
      })
      const data = await res.json()
      if (data.success) {
        setStores(prev => prev.map(s => s.storeId === storeId ? { ...s, storeName: nombre } : s))
        setEditingStore(null)
        setEditName('')
        addToast('Nombre actualizado', 'success')
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setSavingStore(null)
    }
  }

  // Cargar la "bala" de Shopify: guarda las credenciales de una app (id + secret +
  // dominio). No deja cargar otra hasta que una tienda se conecte con esta.
  const handleArmShopify = async () => {
    if (arming) return
    if (!shopForm.shop.trim() || !shopForm.clientId.trim() || !shopForm.clientSecret.trim()) {
      addToast('Completá dominio, Client ID y Client secret', 'error'); return
    }
    setArming(true)
    try {
      const res = await fetch('/api/shopify/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setShopifyArmed(data.armed)
      setShopForm({ shop: '', clientId: '', clientSecret: '', label: '' })
      addToast('App de Shopify cargada ✓', 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'No se pudo cargar la app', 'error')
    } finally {
      setArming(false)
    }
  }

  const handleDiscardShopify = async () => {
    if (!confirm('¿Descartar la app cargada? Vas a poder cargar otra en su lugar.')) return
    try {
      const res = await fetch('/api/shopify/apps', { method: 'DELETE' })
      if (res.ok) { setShopifyArmed(null); addToast('App descartada', 'success') }
      else addToast('No se pudo descartar', 'error')
    } catch { addToast('Error de red', 'error') }
  }

  const handleMarkOrderPaid = async (storeId: string, orderId: string, total?: number) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/mark-order-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderId, total }),
      })
      const data = await res.json()
      if (checkLockResponse(res, data)) return
      if (data.success) {
        addToast('Orden marcada como pagada', 'success')
        // Actualización optimista: verde inmediato sin remover la orden (Realtime la saca cuando TN la confirme)
        if (data.recentMatch) setRecentMatches(prev => [...prev, data.recentMatch])
        if (data.logEntry) setLogEntries(prev => [...prev, data.logEntry])
        setStats(prev => prev ? {
          ...prev,
          manualCount: prev.manualCount + 1,
          manualVolume: prev.manualVolume + (total ?? 0),
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

  // Helper: verifica si la respuesta es un lock 409 y muestra toast
  const checkLockResponse = (res: Response, data: { error?: string }): boolean => {
    if (res.status === 409) {
      addToast(data.error || 'El sistema está procesando otra operación. Esperá unos segundos.', 'error')
      setSystemLocked(true)
      setTimeout(() => setSystemLocked(false), 5000)
      return true
    }
    return false
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
      if (checkLockResponse(res, data)) return
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
          matchedCount: prev.matchedCount + 1,
          matchedVolume: prev.matchedVolume + (data.logEntry?.amount ?? 0),
          pendingOrders: Math.max(0, prev.pendingOrders - 1),
        } : prev)
        setMatchRefreshKey(k => k + 1)
        fetchLog() // confirma que el Registro refleja el estado real de Supabase
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDismissPayment = async (mpPaymentId: string, orderId: string, storeId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId, orderId, storeId }),
      })
      const data = await res.json()
      if (data.success) {
        addToast('Par descartado — el pago y la orden siguen disponibles', 'success')
        setMatchRefreshKey(k => k + 1)
        setDismissedPairs(prev => [...prev, { mpPaymentId, orderId, storeId }])
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // silentRefresh eliminado — reemplazado por Supabase Realtime
  // Los datos se actualizan automáticamente cuando cambian en Supabase

  const handleReevaluar = async () => {
    setMatchRefreshKey(k => k + 1)
    setActionLoading(true)
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/reevaluar', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const newCount = data.newUnmatched ?? data.processed
        const parts = [`${newCount} ${newCount === 1 ? 'pago nuevo' : 'pagos nuevos'}`]
        if (data.cancelled > 0) parts.push(`${data.cancelled} órdenes abandonadas canceladas`)
        addToast(`Actualizado: ${parts.join(' · ')}`, 'success')
        // Enriquecer nombres de pagadores sin nombre (bank_transfer long_name)
        fetch('/api/enrich-names', { method: 'POST' }).catch(() => {})
        await Promise.all([fetchUnmatched(), fetchOrders(), fetchStatus(), fetchLog()])
      } else {
        addToast(`Error al reevaluar: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    } finally {
      setActionLoading(false)
      setIsRefreshing(false)
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
        addToast('Pago marcado como "No es de tiendas"', 'success')
        // NO remover de unmatchedPayments — el pago debe permanecer visible en la pestaña Pagos
        // pintado de amarillo. La exclusión de emparejamiento y sin-coincidencias se da
        // automáticamente porque matchedPaymentIds incluye externallyMarkedPayments.
        // Actualización optimista: amarillo inmediato sin esperar fetchStatus
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

  const handleManualLog = async (mpPaymentId: string, storeName: string, orderNumber: string, matchedOrder: Order | null) => {
    try {
      const res = await fetch('/api/manual-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpPaymentId, storeName, orderNumber, matchedOrder }),
      })
      const data = await res.json()
      if (checkLockResponse(res, data)) return
      if (data.success) {
        // El pago se registró. Si había una orden para marcar y el marcado en la
        // tienda falló (markError) o TN solo pudo agregar una nota (markMethod==='note'),
        // mostrar un modal de cierre obligatorio para que quede claro que NO se marcó.
        if (data.markError) {
          setMarkFailModal({ orderNumber, storeName, error: data.markError })
        } else if (data.markMethod === 'note') {
          setMarkFailModal({ orderNumber, storeName, error: 'TiendaNube no permitió cambiar el estado vía API (solo se agregó una nota a la orden). Marcala como pagada manualmente en TiendaNube.' })
        } else {
          addToast(data.markMethod ? 'Orden marcada como pagada y registrada' : 'Pago registrado manualmente', 'success')
        }
        // La tienda elegida no coincide con ninguna conectada → el pago no suma a su
        // planilla ni a su saldo. Se avisa fuerte para corregirlo al momento.
        if (data.storeWarning) addToast(data.storeWarning, 'error')
        // Actualización local instantánea
        setUnmatchedPayments(prev => prev.filter(u => (u.mpPaymentId || u.payment.mpPaymentId) !== mpPaymentId))
        if (data.logEntry) setLogEntries(prev => [...prev, data.logEntry])
        if (data.recentMatch) setRecentMatches(prev => [...prev, data.recentMatch])
        setStats(prev => prev ? {
          ...prev,
          manualCount: prev.manualCount + 1,
          manualVolume: prev.manualVolume + (data.logEntry?.amount ?? 0),
        } : prev)
        setMatchRefreshKey(k => k + 1)
        fetchLog() // confirma que el Registro refleja el estado real de Supabase
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    }
  }

  // Se ejecuta cuando el modal "Buscar Pagos" empareja un pago de MP con una orden.
  const handlePagoEmparejado = (msg: string) => {
    addToast(msg, 'success')
    fetchSync()  // refresca la cola (el pago, si estaba, ya no debe figurar)
    fetchLog()   // refresca el Registro
    setMatchRefreshKey(k => k + 1)
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

  const handleMarkOrderManual = async (orderId: string, storeId: string, monto: number, medioPago: string, nombrePagador: string, order: import('@/lib/types').Order, cuitPagador?: string, fechaPago?: string, billetera?: string, billeteraOtra?: string) => {
    try {
      const res = await fetch('/api/mark-order-paid-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, storeId, monto, medioPago, nombrePagador, cuitPagador, order, fechaPago, billetera, billeteraOtra }),
      })
      const data = await res.json()
      if (checkLockResponse(res, data)) return
      if (data.success) {
        if (data.tnError) {
          setMarkFailModal({ orderNumber: order?.orderNumber, storeName: order?.storeName, error: data.tnError })
        } else {
          addToast('Orden marcada como pagada', 'success')
        }
        // Actualización optimista: verde inmediato, Realtime confirma y saca la orden de pendientes
        if (data.recentMatch) setRecentMatches(prev => [...prev, data.recentMatch])
        if (data.logEntry) setLogEntries(prev => [...prev, data.logEntry])
        setStats(prev => prev ? {
          ...prev,
          manualCount: prev.manualCount + 1,
          manualVolume: prev.manualVolume + (monto ?? 0),
          pendingOrders: Math.max(0, prev.pendingOrders - 1),
        } : prev)
        setMatchRefreshKey(k => k + 1)
      } else {
        addToast(`Error: ${data.error}`, 'error')
      }
    } catch (err) {
      addToast(`Error: ${err}`, 'error')
    }
  }


  const HOURS_24 = 24 * 60 * 60 * 1000
  const HOURS_48 = 48 * 60 * 60 * 1000
  // Cutoffs separados para pagos y órdenes
  const HARD_CUTOFF_PAYMENTS_MS = HARD_CUTOFF_PAYMENTS.getTime()
  const HARD_CUTOFF_ORDERS_MS = HARD_CUTOFF_ORDERS.getTime()
  const cutoff24 = Math.max(Date.now() - HOURS_24, Math.min(HARD_CUTOFF_PAYMENTS_MS, HARD_CUTOFF_ORDERS_MS))
  const cutoff48 = Math.max(Date.now() - HOURS_48, Math.min(HARD_CUTOFF_PAYMENTS_MS, HARD_CUTOFF_ORDERS_MS))

  // Todas las órdenes de las últimas 48hs (pendientes + pagadas desde log + fallback desde recentMatches)
  const allRecentOrders = useMemo((): Order[] => {
    const now = Date.now()
    const pendingMap = new Map(orders.map(o => [`${o.storeId}-${o.orderId}`, o]))
    const seenIds = new Set<string>()

    const fromLog: Order[] = logEntries
      .filter(e =>
        (e.action === 'auto_paid' || e.action === 'manual_paid') &&
        e.orderId && e.storeId &&
        new Date(e.timestamp).getTime() >= cutoff48
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
        new Date(m.matchedAt).getTime() >= cutoff48)
      .map(m => m.order!)
      .filter(o => {
        const key = `${o.storeId}-${o.orderId}`
        if (pendingMap.has(key) || seenIds.has(key)) return false
        seenIds.add(key)
        return true
      })

    return [...orders, ...fromLog, ...fromRecent]
      .filter(o => new Date(o.createdAt).getTime() >= HARD_CUTOFF_ORDERS_MS)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [orders, logEntries, recentMatches, cutoff48, HARD_CUTOFF_ORDERS_MS])

  // División tiendas de terceros (ej. Hemat): sus órdenes NO participan del emparejamiento
  // (ni auto ni manual con la cola) y van a su propia pestaña. El resto usa ordenesPropias.
  const ordenesPropias = useMemo(() => allRecentOrders.filter(o => !esOrdenDeTercero(o.storeId)), [allRecentOrders])
  const ordenesTerceros = useMemo(() => allRecentOrders.filter(o => esOrdenDeTercero(o.storeId)), [allRecentOrders])

  // Todos los pagos de las últimas 48hs (macheados + no macheados)
  const allRecentPayments = useMemo((): Payment[] => {
    const seenIds = new Set<string>()

    // Pagos macheados del registro (desde cutoff efectivo)
    const fromLog = logEntries
      .filter(e => (e.action === 'auto_paid' || e.action === 'manual_paid') && e.payment &&
        new Date(e.timestamp).getTime() >= cutoff48)
      .map(e => e.payment!)
      .filter(p => { if (seenIds.has(p.mpPaymentId)) return false; seenIds.add(p.mpPaymentId); return true })

    // Fallback: pagos desde recentMatches cuando el log fue borrado
    const fromRecent = recentMatches
      .filter(m => m.payment && new Date(m.matchedAt).getTime() >= cutoff48)
      .map(m => m.payment!)
      .filter(p => { if (seenIds.has(p.mpPaymentId)) return false; seenIds.add(p.mpPaymentId); return true })

    // Pagos no macheados (desde cutoff efectivo 48h). Los de billeteras "sin
    // vencimiento" (MF, Lacar) se muestran siempre mientras no estén marcados
    // como externos — al marcarse, vuelven al cutoff normal de 48hs.
    const externallyMarkedSet = new Set(stats?.externallyMarkedPayments ?? [])
    const unmatched = unmatchedPayments
      .filter(u => {
        if (new Date(u.payment.fechaPago).getTime() >= cutoff48) return true
        const id = u.mpPaymentId || u.payment.mpPaymentId
        if (externallyMarkedSet.has(id || '')) return false
        const wallet = paymentWalletId(u.payment.source)
        return !!wallet && WALLETS_SIN_VENCIMIENTO.includes(wallet)
      })
      .map(u => u.payment)
      .filter(p => !seenIds.has(p.mpPaymentId))

    return [...fromLog, ...fromRecent, ...unmatched]
      .filter(p => new Date(p.fechaPago).getTime() >= HARD_CUTOFF_PAYMENTS_MS)
      // La pestaña Pagos muestra solo pagos verificables (API de MercadoPago o
      // webhook de Fiwind). Los marcados manuales de orden (id 'manual_…') quedan
      // únicamente en el Registro: no hay un pago real que los respalde.
      .filter(p => !(p.mpPaymentId || '').startsWith('manual_'))
  }, [unmatchedPayments, logEntries, recentMatches, cutoff48, HARD_CUTOFF_PAYMENTS_MS, stats?.externallyMarkedPayments])

  // IDs de pagos y órdenes ya macheados (para resaltar en verde en las pestañas)
  // Usan recentMatches (auto-limpia a 24h) para ser independientes del borrado manual del Registro
  const matchedPaymentIds = useMemo(() => new Set([
    ...recentMatches.map(m => m.mpPaymentId).filter(Boolean) as string[],
    ...(stats?.externallyMarkedPayments ?? []),
    // Pagos ya registrados en el log (auto/manual) — espejo de matchedOrderIds. Así un
    // pago emparejado hace más de 24hs (fuera de recentMatches) igual figura como
    // RECIBIDO en la pestaña Pagos, que muestra pagos macheados hasta 48hs.
    ...logEntries
      .filter(e => (e.action === 'manual_paid' || e.action === 'auto_paid') && e.mpPaymentId)
      .map(e => e.mpPaymentId as string),
  ]), [recentMatches, stats?.externallyMarkedPayments, logEntries])

  const matchedOrderIds = useMemo(() => new Set([
    ...recentMatches.filter(m => m.orderId && m.storeId).map(m => `${m.storeId}-${m.orderId}`),
    ...(stats?.externallyMarkedOrders ?? []),
    // Excluir órdenes ya registradas en el log — evita que inflen el conteo de
    // "otras órdenes mismo monto" mientras el cache de TN aún no se actualizó
    ...logEntries
      .filter(e => e.orderId && e.storeId && (e.action === 'manual_paid' || e.action === 'auto_paid'))
      .map(e => `${e.storeId}-${e.orderId}`),
  ]), [recentMatches, stats?.externallyMarkedOrders, logEntries])

  // Arrays filtrados memoizados para ManualMatchTab (evitar nuevas referencias en cada render)
  const filteredUnmatched = useMemo(() =>
    unmatchedPayments.filter(u => !matchedPaymentIds.has(u.payment.mpPaymentId)),
    [unmatchedPayments, matchedPaymentIds])
  const filteredOrders = useMemo(() =>
    orders.filter(o => !matchedOrderIds.has(`${o.storeId}-${o.orderId}`) && !esOrdenDeTercero(o.storeId)),
    [orders, matchedOrderIds])

  // Mapa de órdenes duplicadas: compara dentro de la misma tienda por email/CUIT/nombre + monto
  const duplicateMap = useMemo(() => {
    const map = new Map<string, { order: Order; confidence: 'alta' | 'media' }>()
    const WINDOW_48H = 48 * 60 * 60 * 1000
    const WINDOW_24H = 24 * 60 * 60 * 1000

    for (let i = 0; i < ordenesPropias.length; i++) {
      for (let j = i + 1; j < ordenesPropias.length; j++) {
        const a = ordenesPropias[i]
        const b = ordenesPropias[j]

        // Solo dentro de la misma tienda
        if (a.storeId !== b.storeId) continue
        // Misma orden → ignorar
        if (a.orderId === b.orderId) continue
        // Montos distintos → no es duplicado
        if (a.total !== b.total) continue

        const timeDiff = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        const emailMatch = !!(
          a.customerEmail && b.customerEmail &&
          a.customerEmail.toLowerCase() === b.customerEmail.toLowerCase()
        )
        const cuitMatch = !!(
          a.customerCuit && b.customerCuit &&
          a.customerCuit.replace(/\D/g, '') === b.customerCuit.replace(/\D/g, '') &&
          a.customerCuit.replace(/\D/g, '').length >= 7
        )

        const keyA = `${a.storeId}-${a.orderId}`
        const keyB = `${b.storeId}-${b.orderId}`

        if ((emailMatch || cuitMatch) && timeDiff <= WINDOW_48H) {
          if (!map.has(keyA)) map.set(keyA, { order: b, confidence: 'alta' })
          if (!map.has(keyB)) map.set(keyB, { order: a, confidence: 'alta' })
        } else if (timeDiff <= WINDOW_24H) {
          const normA = a.customerName?.toLowerCase().trim().replace(/\s+/g, ' ')
          const normB = b.customerName?.toLowerCase().trim().replace(/\s+/g, ' ')
          if (normA && normB && normA === normB && normA.length > 4) {
            if (!map.has(keyA)) map.set(keyA, { order: b, confidence: 'media' })
            if (!map.has(keyB)) map.set(keyB, { order: a, confidence: 'media' })
          }
        }
      }
    }
    return map
  }, [ordenesPropias])

  // Pagos de las últimas 48hs sin coincidencia con ninguna orden
  const paymentsWithoutMatch = useMemo((): Payment[] => {
    const now = Date.now()
    return unmatchedPayments
      .filter(u => {
        if ((now - new Date(u.payment.fechaPago).getTime()) <= HOURS_48) return true
        // Billeteras "sin vencimiento" (MF, Lacar): se mantienen visibles pasadas
        // las 48hs. Si ya se marcaron como externas, el filtro de abajo las saca igual.
        const wallet = paymentWalletId(u.payment.source)
        return !!wallet && WALLETS_SIN_VENCIMIENTO.includes(wallet)
      })
      .map(u => u.payment)
      .filter(p => !matchedPaymentIds.has(p.mpPaymentId))
  }, [unmatchedPayments, matchedPaymentIds, HOURS_48])

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

  const tabs: { id: Tab; label: string; primary?: boolean; badge?: number; badgeColor?: string }[] = [
    { id: 'manual', label: 'Emparejamiento', primary: true },
    { id: 'ordenes', label: `Órdenes (${ordenesPropias.length})` },
    { id: 'pagos', label: `Pagos (${allRecentPayments.length})` },
    { id: 'sin-coincidencia', label: `Sin coincidencia (${paymentsWithoutMatch.length})` },
    { id: 'registro', label: 'Registro' },
    { id: 'terceros', label: `Órdenes de terceros (${ordenesTerceros.length})` },
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
      <header className="sticky top-0 z-40 backdrop-blur-xl safe-top"
        style={{ borderBottom: '1px solid rgba(0,212,255,0.08)', background: 'rgba(6,11,20,0.9)' }}>
        <div
          className="mx-auto max-w-[1400px] px-3 sm:px-6 py-3 items-center gap-2 sm:gap-4"
          style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}
        >
          {/* LEFT: User avatar + auto-match buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
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
                className="absolute left-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden z-50"
                style={{
                  top: '100%',
                  background: 'linear-gradient(135deg, #0d1117, #111827)',
                  border: '1px solid rgba(0,212,255,0.15)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
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

          {/* Centro de errores (campana) */}
          <div ref={erroresMenuRef} className="relative flex items-center">
            <button
              onClick={handleAbrirErrores}
              title="Errores"
              className="relative flex items-center justify-center w-9 h-9 rounded-full transition-all"
              style={{
                background: erroresNoVistos > 0 ? 'rgba(248,113,113,0.12)' : 'linear-gradient(135deg, #00d4ff22, #0070f322)',
                border: erroresNoVistos > 0 ? '1px solid rgba(248,113,113,0.45)' : '1px solid rgba(0,212,255,0.3)',
                color: erroresNoVistos > 0 ? '#f87171' : '#00d4ff',
                boxShadow: erroresOpen ? '0 0 14px rgba(0,212,255,0.25)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {erroresNoVistos > 0 && (
                <span
                  className="absolute flex items-center justify-center text-[10px] font-bold rounded-full"
                  style={{
                    top: '-4px', right: '-4px', minWidth: '18px', height: '18px', padding: '0 4px',
                    background: '#ef4444', color: '#fff', border: '2px solid #060b14',
                  }}
                >
                  {erroresNoVistos > 9 ? '9+' : erroresNoVistos}
                </span>
              )}
            </button>
            {erroresOpen && (
              <div
                className="absolute left-0 mt-2 rounded-xl overflow-hidden z-50"
                style={{
                  top: '100%', width: '360px', maxWidth: '90vw',
                  background: 'linear-gradient(135deg, #0d1117, #111827)',
                  border: '1px solid rgba(0,212,255,0.15)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
                <div className="px-4 py-3 text-xs font-semibold flex items-center justify-between"
                  style={{ color: 'rgba(0,212,255,0.8)', borderBottom: '1px solid rgba(0,212,255,0.1)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  <span>Errores</span>
                  <span style={{ color: 'rgba(148,163,184,0.5)' }}>{errores.length}</span>
                </div>
                <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  {errores.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm" style={{ color: 'rgba(148,163,184,0.6)' }}>
                      Sin errores
                    </div>
                  ) : (
                    errores.map(e => (
                      <div key={e.id} className="px-4 py-3"
                        style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                            background: e.level === 'error' ? '#f87171' : '#fbbf24',
                          }} />
                          <span className="text-[10px] font-semibold uppercase" style={{ color: 'rgba(148,163,184,0.55)', letterSpacing: '0.05em' }}>
                            {e.source}
                          </span>
                          <span className="text-[10px] ml-auto" style={{ color: 'rgba(148,163,184,0.4)' }}>
                            {new Date(e.timestamp).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })}
                          </span>
                        </div>
                        <div className="text-xs leading-snug" style={{ color: 'rgba(226,232,240,0.9)' }}>
                          {e.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Administración Financiera (a esta pantalla solo llega un admin) */}
          <Link
            href="/finanzas"
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 min-h-[44px] min-w-[44px] text-xs font-medium transition-colors shrink-0 active:opacity-70"
            style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)', color: '#00d4ff', textDecoration: 'none', whiteSpace: 'nowrap', touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(0,212,255,0.2)' }}
            title="Administración Financiera"
            aria-label="Administración Financiera"
          >
            <span className="text-lg lg:text-xs leading-none">💰</span>
            <span className="hidden lg:inline">Administración Financiera</span>
          </Link>
          </div>

          {/* CENTER: Logo + subtitle */}
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            <img
              src="/logo.png"
              alt="CriptoBlue"
              className="h-12 w-12 sm:h-20 sm:w-20 rounded-full object-cover"
              style={{ boxShadow: '0 0 24px rgba(0,212,255,0.5), 0 0 48px rgba(0,212,255,0.15)' }}
            />
            <span
              className="text-[9px] sm:text-xs font-semibold whitespace-nowrap"
              style={{ color: 'rgba(0,212,255,0.8)', letterSpacing: '0.12em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(0,212,255,0.4)' }}
            >
              Automatización de Procesos
            </span>
          </div>

          {/* RIGHT: Sync info + Actualizar + Tiendas dropdown */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-2 min-w-0">
            <div className="hidden md:flex items-center">
            {isRefreshing || stats?.currentPhase === 'syncing' ? (
              <span style={{ fontSize: '11px', color: '#00d4ff', whiteSpace: 'nowrap', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Actualizando...
              </span>
            ) : stats?.currentPhase === 'auto-matching' ? (
              <span style={{ fontSize: '11px', color: '#00ff88', whiteSpace: 'nowrap', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⚡</span> Marcando automáticamente...
              </span>
            ) : stats?.lastMPCheck ? (
              <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.4)', whiteSpace: 'nowrap' }}>
                Última actualización: {new Date(stats.lastMPCheck).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })}
              </span>
            ) : null}
            </div>
            <button
              onClick={handleReevaluar}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-xl px-3 sm:px-4 py-2.5 text-xs font-medium transition-all disabled:opacity-50 shrink-0"
              style={{
                background: 'rgba(0,212,255,0.08)',
                border: '1px solid rgba(0,212,255,0.25)',
                color: '#00d4ff',
              }}
            >
              {actionLoading ? '...' : <>↻<span className="hidden sm:inline">&nbsp;Actualizar</span></>}
            </button>
            <div ref={storesMenuRef} className="relative shrink-0">
              <button
                onClick={() => { setStoresOpen(v => !v); if (!storesOpen) fetchStores() }}
                className="flex items-center gap-2 rounded-xl px-3 sm:px-4 py-2.5 text-xs font-medium transition-all"
                style={{
                  background: storesOpen ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(0,212,255,0.2)',
                  color: 'rgba(148,163,184,0.9)',
                  boxShadow: storesOpen ? '0 0 16px rgba(0,212,255,0.1)' : 'none',
                }}
              >
                🏪 <span className="hidden sm:inline">Tiendas</span>
                <span style={{ color: 'rgba(0,212,255,0.5)', fontSize: '10px', marginLeft: '2px' }}>
                  {storesOpen ? '▲' : '▼'}
                </span>
              </button>

              {storesOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden z-50"
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
                    <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                      {stores.map(store => (
                        <div
                          key={store.storeId}
                          className="w-full px-4 py-3 text-sm group"
                          style={{ borderBottom: '1px solid rgba(0,212,255,0.05)' }}
                        >
                          {editingStore === store.storeId ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleRenameStore(store.storeId)
                                  if (e.key === 'Escape') { setEditingStore(null); setEditName('') }
                                }}
                                className="flex-1 min-w-0 text-sm rounded-md px-2 py-1"
                                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,212,255,0.35)', color: 'white', outline: 'none' }}
                              />
                              <button
                                onClick={() => handleRenameStore(store.storeId)}
                                disabled={savingStore === store.storeId || !editName.trim()}
                                className="text-sm flex-shrink-0 disabled:opacity-40 cursor-pointer"
                                style={{ color: '#00ff88' }}
                                title="Guardar"
                              >
                                {savingStore === store.storeId ? '...' : '✓'}
                              </button>
                              <button
                                onClick={() => { setEditingStore(null); setEditName('') }}
                                className="text-sm flex-shrink-0 cursor-pointer"
                                style={{ color: 'rgba(148,163,184,0.7)' }}
                                title="Cancelar"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: '#00ff88', boxShadow: '0 0 6px rgba(0,255,136,0.6)' }} />
                                <div className="flex flex-col min-w-0">
                                  <span className="text-sm text-white truncate">{store.storeName}</span>
                                  <span className="text-[11px] leading-tight" style={{ color: 'rgba(148,163,184,0.6)' }}>
                                    {store.platform === 'shopify' ? 'Shopify' : `app Tiendanube ${store.appId ?? '27051'}`}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => { setEditingStore(store.storeId); setEditName(store.storeName) }}
                                  className="text-xs cursor-pointer"
                                  style={{ color: '#00d4ff' }}
                                >
                                  editar
                                </button>
                                <button
                                  onClick={() => handleDeleteStore(store.storeId, store.storeName)}
                                  disabled={deletingStore === store.storeId}
                                  className="text-xs disabled:opacity-50 cursor-pointer"
                                  style={{ color: '#f87171' }}
                                >
                                  {deletingStore === store.storeId ? '...' : '✕ eliminar'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Botón agregar tienda */}
                  <div className="p-3" style={{ borderTop: stores.length > 0 ? '1px solid rgba(0,212,255,0.08)' : 'none' }}>
                    <button
                      onClick={() => { setStoresOpen(false); setAddStep('choose'); setCopiedLink(false); setPlatformModalOpen(true) }}
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

      <main className="relative mx-auto max-w-[1400px] px-3 sm:px-6 py-6 space-y-6">
        <StatsBar stats={stats} />

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
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: '18px', height: '18px', borderRadius: '9px',
                    fontSize: '10px', fontWeight: 800,
                    background: t.badgeColor ?? '#f87171',
                    color: 'white',
                    padding: '0 5px',
                    boxShadow: `0 0 8px ${t.badgeColor ?? '#f87171'}66`,
                  }}>
                    {t.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Modal selección de plataforma */}
        {/* Modal de cierre obligatorio: pago registrado pero NO marcado en la tienda */}
        {markFailModal && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#0f1923', border: '1px solid rgba(255,70,70,0.35)', borderRadius: '16px', padding: 'clamp(20px, 5vw, 32px)', width: '440px', maxWidth: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            >
              <div style={{ fontSize: '40px', textAlign: 'center', marginBottom: '10px' }}>⚠️</div>
              <h2 style={{ color: '#ff7070', fontSize: '18px', fontWeight: 700, marginBottom: '12px', textAlign: 'center' }}>
                El pago se registró, pero NO se marcó en la tienda
              </h2>
              <p style={{ color: 'rgba(226,232,240,0.85)', fontSize: '14px', textAlign: 'center', marginBottom: '14px', lineHeight: 1.55 }}>
                {markFailModal.orderNumber
                  ? <>La orden <b>#{markFailModal.orderNumber}</b>{markFailModal.storeName ? <> de <b>{markFailModal.storeName}</b></> : null} quedó en el registro de CriptoBlue, pero <b>tenés que marcarla como pagada manualmente en la tienda</b>.</>
                  : <>El pago quedó registrado en CriptoBlue, pero <b>tenés que marcar la orden como pagada manualmente en la tienda</b>.</>}
              </p>
              <div style={{ background: 'rgba(255,70,70,0.08)', border: '1px solid rgba(255,70,70,0.2)', borderRadius: '8px', padding: '10px 12px', marginBottom: '22px' }}>
                <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Detalle</div>
                <div style={{ color: 'rgba(255,150,150,0.95)', fontSize: '13px', wordBreak: 'break-word' }}>{markFailModal.error}</div>
              </div>
              <button
                onClick={() => setMarkFailModal(null)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: '#ff5555', color: 'white', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}
              >
                Entendido
              </button>
            </div>
          </div>
        )}

        {platformModalOpen && (
          <div
            onClick={() => { setPlatformModalOpen(false); setAddStep('choose'); setCopiedLink(false) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#0f1923', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '16px', padding: 'clamp(20px, 5vw, 32px)', width: 'min(460px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            >
              {addStep === 'choose' && (
                <>
                  <h2 style={{ color: 'white', fontSize: '18px', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }}>Agregar tienda</h2>
                  <p style={{ color: 'rgba(148,163,184,0.6)', fontSize: '13px', textAlign: 'center', marginBottom: '18px' }}>¿Desde qué plataforma querés conectar?</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Tienda Nube */}
                    <button
                      onClick={() => { setAddStep('tn'); setCopiedLink(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(0,100,255,0.3)', background: 'rgba(0,100,255,0.06)', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,100,255,0.14)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,100,255,0.5)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,100,255,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,100,255,0.3)' }}
                    >
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="36" height="36" rx="8" fill="#1F5CFF"/>
                        <path d="M27.5 20.5C27.5 23.26 25.26 25.5 22.5 25.5H11C8.79 25.5 7 23.71 7 21.5C7 19.57 8.38 17.96 10.22 17.58C10.08 17.08 10 16.55 10 16C10 12.69 12.69 10 16 10C18.7 10 20.99 11.71 21.75 14.13C22.0 14.04 22.24 14 22.5 14C25.26 14 27.5 16.24 27.5 19C27.5 19.18 27.49 19.35 27.47 19.52C27.49 19.68 27.5 19.84 27.5 20C27.5 20.17 27.5 20.33 27.5 20.5Z" fill="white"/>
                      </svg>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: '15px' }}>Tienda Nube</div>
                        <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: '12px' }}>Link directo para el dueño</div>
                      </div>
                    </button>

                    {/* Shopify */}
                    <button
                      onClick={() => setAddStep('shopify')}
                      style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(150,191,72,0.3)', background: 'rgba(150,191,72,0.06)', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(150,191,72,0.14)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(150,191,72,0.5)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(150,191,72,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(150,191,72,0.3)' }}
                    >
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="36" height="36" rx="8" fill="#96BF48"/>
                        <path d="M24.18 10.44C24.16 10.3 24.04 10.22 23.92 10.21C23.8 10.2 21.6 10.16 21.6 10.16C21.6 10.16 19.74 8.36 19.56 8.18C19.38 8 19.02 8.06 18.88 8.1C18.86 8.1 18.5 8.21 17.9 8.4C17.64 7.64 17.2 6.96 16.4 6.96H16.28C16.04 6.64 15.74 6.5 15.48 6.5C13.38 6.5 12.36 9.04 12.04 10.32C11.14 10.6 10.5 10.8 10.42 10.82C9.9 10.98 9.88 11 9.82 11.48C9.78 11.84 8.5 21.56 8.5 21.56L19.34 23.5L27.5 21.72C27.5 21.72 24.2 10.58 24.18 10.44ZM17.2 8.78C16.74 8.92 16.22 9.08 15.66 9.26C15.82 8.58 16.18 7.9 16.8 7.64C17.06 8 17.16 8.44 17.2 8.78ZM15.46 7.08C15.56 7.08 15.64 7.1 15.72 7.14C14.98 7.5 14.22 8.36 13.9 10.04C13.44 10.18 13 10.32 12.58 10.44C12.96 9.1 13.86 7.08 15.46 7.08ZM17.96 19.84C17.96 19.84 17.24 19.44 16.36 19.44C15.06 19.44 15 20.28 15 20.48C15 21.74 17.9 22.22 17.9 24.86C17.9 26.94 16.6 28.3 14.84 28.3C12.72 28.3 11.64 27 11.64 27L12.22 25.14C12.22 25.14 13.34 26 14.26 26C14.86 26 15.1 25.52 15.1 25.18C15.1 23.54 12.76 23.48 12.76 21.06C12.76 19 14.18 17 17 17C18.08 17 18.54 17.28 18.54 17.28L17.96 19.84Z" fill="white"/>
                      </svg>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: '15px' }}>Shopify</div>
                        <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: '12px' }}>Instructivo para crear la app</div>
                      </div>
                    </button>
                  </div>

                  <button
                    onClick={() => { setPlatformModalOpen(false); setAddStep('choose'); setCopiedLink(false) }}
                    style={{ marginTop: '20px', width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.15)', background: 'transparent', color: 'rgba(148,163,184,0.5)', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                </>
              )}

              {addStep === 'tn' && (
                <>
                  <button
                    onClick={() => { setAddStep('choose'); setCopiedLink(false) }}
                    style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.6)', fontSize: '13px', cursor: 'pointer', marginBottom: '16px', padding: 0 }}
                  >
                    ← Volver
                  </button>
                  <h2 style={{ color: 'white', fontSize: '18px', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }}>Conectar Tienda Nube</h2>
                  <p style={{ color: 'rgba(148,163,184,0.7)', fontSize: '13px', textAlign: 'center', marginBottom: '20px', lineHeight: 1.55 }}>
                    Copiá este link y pasáselo al <b style={{ color: 'rgba(226,232,240,0.9)' }}>dueño de la tienda</b>. Cuando lo abra e instale la app desde su Tienda Nube, la tienda aparece sola en esta lista con su nombre real.
                  </p>

                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <input
                      readOnly
                      value={typeof window !== 'undefined' ? `${window.location.origin}/api/tn/connect` : '/api/tn/connect'}
                      onFocus={e => e.currentTarget.select()}
                      style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(0,100,255,0.3)', background: 'rgba(0,0,0,0.35)', color: 'rgba(226,232,240,0.92)', fontSize: '13px', outline: 'none', fontFamily: 'monospace' }}
                    />
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${window.location.origin}/api/tn/connect`)
                          setCopiedLink(true)
                          setTimeout(() => setCopiedLink(false), 2000)
                        } catch { addToast('No se pudo copiar el link', 'error') }
                      }}
                      style={{ flexShrink: 0, padding: '10px 16px', borderRadius: '10px', border: 'none', background: copiedLink ? 'linear-gradient(135deg, #00c851, #00a844)' : 'linear-gradient(135deg, #00d4ff, #0070f3)', color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {copiedLink ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>

                  <p style={{ color: 'rgba(148,163,184,0.5)', fontSize: '11.5px', lineHeight: 1.5 }}>
                    El dueño no tiene que escribir ningún nombre. Si el nombre llega mal, editalo con el lápiz de la lista.
                  </p>
                </>
              )}

              {addStep === 'shopify' && (
                <>
                  <button
                    onClick={() => setAddStep('choose')}
                    style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.6)', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}
                  >
                    ← Volver
                  </button>
                  <h2 style={{ color: 'white', fontSize: '18px', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }}>Conectar Shopify</h2>

                  {shopifyArmed ? (
                    /* Bala cargada: app esperando que una tienda se conecte con ella. */
                    <>
                      <div style={{ background: 'rgba(150,191,72,0.08)', border: '1px solid rgba(150,191,72,0.35)', borderRadius: '12px', padding: '14px 16px', marginTop: '10px', marginBottom: '16px' }}>
                        <div style={{ color: '#96BF48', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>🔫 App cargada</div>
                        <div style={{ color: 'rgba(226,232,240,0.9)', fontSize: '13px' }}>{shopifyArmed.label}</div>
                        <div style={{ color: 'rgba(148,163,184,0.65)', fontSize: '12px', marginTop: '2px', wordBreak: 'break-all' }}>{shopifyArmed.shop}</div>
                      </div>

                      <p style={{ color: 'rgba(148,163,184,0.75)', fontSize: '13px', lineHeight: 1.55, marginBottom: '10px' }}>
                        Pasale al dueño el <b style={{ color: 'rgba(226,232,240,0.9)' }}>link de instalación de Shopify</b> (Generate link) y <b style={{ color: 'rgba(226,232,240,0.9)' }}>este link</b> para terminar de conectarla:
                      </p>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                        <input
                          readOnly
                          value={typeof window !== 'undefined' ? `${window.location.origin}/api/shopify/connect?shop=${shopifyArmed.shop}` : ''}
                          onFocus={e => e.currentTarget.select()}
                          style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(150,191,72,0.3)', background: 'rgba(0,0,0,0.35)', color: 'rgba(226,232,240,0.92)', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
                        />
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(`${window.location.origin}/api/shopify/connect?shop=${shopifyArmed.shop}`)
                              setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000)
                            } catch { addToast('No se pudo copiar el link', 'error') }
                          }}
                          style={{ flexShrink: 0, padding: '10px 16px', borderRadius: '10px', border: 'none', background: copiedLink ? 'linear-gradient(135deg, #00c851, #00a844)' : 'linear-gradient(135deg, #96BF48, #7a9e38)', color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          {copiedLink ? '✓ Copiado' : 'Copiar'}
                        </button>
                      </div>
                      <p style={{ color: 'rgba(148,163,184,0.55)', fontSize: '11.5px', lineHeight: 1.5, marginBottom: '16px' }}>
                        No podés cargar otra app hasta que una tienda se conecte con esta. Cuando el dueño la conecte, se libera sola y este espacio queda listo para la próxima.
                      </p>
                      <button
                        onClick={handleDiscardShopify}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)', color: '#f87171', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Descartar app cargada
                      </button>
                    </>
                  ) : (
                    /* Sin bala: instructivo + formulario para cargar la app. */
                    <>
                      <p style={{ color: 'rgba(148,163,184,0.7)', fontSize: '13px', textAlign: 'center', marginBottom: '18px', lineHeight: 1.55 }}>
                        Shopify obliga a crear <b style={{ color: 'rgba(226,232,240,0.9)' }}>una app por cada tienda</b>. Seguí estos pasos:
                      </p>

                      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {[
                          <>Entrá a <b style={{ color: '#96BF48' }}>partners.shopify.com</b> → <b>Apps</b> → <b>Create app</b> → <b>Create app manually</b>. Ponele un nombre (ej. &quot;Automatización [Tienda]&quot;).</>,
                          <>En <b>Configuration</b>, cargá estos valores <b>exactos</b>:
                            <div style={{ marginTop: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(150,191,72,0.2)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', lineHeight: 1.7 }}>
                              <div><span style={{ color: 'rgba(148,163,184,0.6)' }}>App URL:</span> <code style={{ color: '#96BF48', userSelect: 'all' }}>https://criptoblue.vercel.app/</code></div>
                              <div><span style={{ color: 'rgba(148,163,184,0.6)' }}>Redirect URL:</span> <code style={{ color: '#96BF48', userSelect: 'all', wordBreak: 'break-all' }}>https://criptoblue.vercel.app/api/shopify/callback</code></div>
                              <div><span style={{ color: 'rgba(148,163,184,0.6)' }}>Scopes:</span> <code style={{ color: '#96BF48', userSelect: 'all' }}>read_orders, write_orders, read_customers</code></div>
                              <div><span style={{ color: 'rgba(148,163,184,0.6)' }}>Embed app in Shopify admin:</span> No</div>
                            </div>
                          </>,
                          <>En <b>Distribution</b> elegí <b>Custom distribution</b> y poné el dominio de la tienda (<code style={{ color: '#96BF48', userSelect: 'all' }}>mitienda.myshopify.com</code>). Esto habilita la app para esa tienda.</>,
                          <>En <b>API credentials</b>, copiá el <b>Client ID</b> y el <b>Client secret</b> — los vas a pegar <b>acá abajo</b>.</>,
                          <>En <b>Distribution</b>, tocá <b>Generate link</b> y mandale ese link al dueño para que <b>instale</b> la app en su tienda.</>,
                        ].map((paso, i) => (
                          <li key={i} style={{ display: 'flex', gap: '10px', fontSize: '13px', color: 'rgba(226,232,240,0.85)', lineHeight: 1.55 }}>
                            <span style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(150,191,72,0.15)', border: '1px solid rgba(150,191,72,0.4)', color: '#96BF48', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                            <div style={{ minWidth: 0 }}>{paso}</div>
                          </li>
                        ))}
                      </ol>

                      <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                        <div style={{ color: '#96BF48', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>Cargá la app acá 🔫</div>
                        <p style={{ color: 'rgba(148,163,184,0.6)', fontSize: '11.5px', lineHeight: 1.5, marginBottom: '12px' }}>
                          Queda guardada (no hace falta redeploy). Vas a poder cargar la próxima recién cuando una tienda se conecte con esta.
                        </p>
                        {[
                          { k: 'shop', label: 'Dominio de la tienda', ph: 'mitienda.myshopify.com' },
                          { k: 'clientId', label: 'Client ID', ph: 'Client ID de la app' },
                          { k: 'clientSecret', label: 'Client secret', ph: 'Client secret de la app' },
                          { k: 'label', label: 'Nombre (opcional)', ph: 'Ej: Automatización Bambua' },
                        ].map(f => (
                          <div key={f.k} style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(150,191,72,0.75)', marginBottom: '4px' }}>{f.label}</label>
                            <input
                              value={shopForm[f.k as keyof typeof shopForm]}
                              onChange={e => setShopForm(s => ({ ...s, [f.k]: e.target.value }))}
                              placeholder={f.ph}
                              disabled={arming}
                              style={{ width: '100%', padding: '9px 12px', borderRadius: '10px', border: '1px solid rgba(150,191,72,0.3)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        ))}
                        <button
                          onClick={handleArmShopify}
                          disabled={arming || !shopForm.shop.trim() || !shopForm.clientId.trim() || !shopForm.clientSecret.trim()}
                          style={{ width: '100%', marginTop: '4px', padding: '11px', borderRadius: '10px', border: 'none', background: (!arming && shopForm.shop.trim() && shopForm.clientId.trim() && shopForm.clientSecret.trim()) ? 'linear-gradient(135deg, #96BF48, #7a9e38)' : 'rgba(255,255,255,0.1)', color: 'white', fontSize: '15px', fontWeight: 700, cursor: (!arming && shopForm.shop.trim() && shopForm.clientId.trim() && shopForm.clientSecret.trim()) ? 'pointer' : 'not-allowed' }}
                        >
                          {arming ? 'Cargando…' : 'Cargar app'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Tab content */}
        <div>
          {tab === 'manual' && <ManualMatchTab unmatchedPayments={filteredUnmatched} orders={filteredOrders} duplicateMap={duplicateMap} matchedIds={matchedOrderIds} onManualMatch={handleManualMatch} onDismissPayment={handleDismissPayment} onMarkOrderPaid={handleMarkOrderPaid} dismissedPairs={dismissedPairs} loading={actionLoading || systemLocked} lastMPCheck={stats?.lastMPCheck ?? null} refreshKey={matchRefreshKey} />}
          {tab === 'ordenes' && <OrdersListTab orders={ordenesPropias} stores={stores} matchedIds={matchedOrderIds} duplicateMap={duplicateMap} onMarkExternal={handleMarkOrderExternal} onMarkManual={handleMarkOrderManual} loading={actionLoading || systemLocked} />}
          {tab === 'pagos' && <PaymentsListTab payments={allRecentPayments} orders={ordenesPropias} stores={stores} matchedIds={matchedPaymentIds} externallyMarkedIds={new Set(stats?.externallyMarkedPayments ?? [])} title="Pagos · últimas 48hs" emptyText="No hay pagos en las últimas 48 horas" onMarkReceived={handleMarkPaymentReceived} onManualLog={handleManualLog} showBuscarPagos onEmparejado={handlePagoEmparejado} loading={actionLoading || systemLocked} />}
          {tab === 'sin-coincidencia' && <PaymentsListTab payments={paymentsWithoutMatch} orders={ordenesPropias} stores={stores} externallyMarkedIds={new Set(stats?.externallyMarkedPayments ?? [])} title="Pagos sin coincidencia · últimas 48hs" emptyText="Todos los pagos de las últimas 48hs tienen una orden asignada" onMarkReceived={handleMarkPaymentReceived} onManualLog={handleManualLog} loading={actionLoading || systemLocked} />}
          {tab === 'terceros' && <OrdersListTab orders={ordenesTerceros} stores={stores} matchedIds={matchedOrderIds} duplicateMap={duplicateMap} onMarkExternal={handleMarkOrderExternal} onMarkManual={handleMarkOrderManual} loading={actionLoading || systemLocked} />}
          {tab === 'registro' && <RegistroTab refreshKey={logVersion} onEntryEdited={fetchLog} />}
        </div>
      </main>
    </div>
  )
}
