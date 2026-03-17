'use client'

import { useEffect, useState } from 'react'
import type { Store } from '@/lib/types'

interface Props {
  onToast: (msg: string, type: 'success' | 'error') => void
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export default function StoresTab({ onToast }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')

  async function fetchStores() {
    try {
      const res = await fetch('/api/stores')
      if (res.ok) setStores(await res.json())
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStores() }, [])

  async function handleDelete(storeId: string, storeName: string) {
    if (!confirm(`¿Desconectar "${storeName}"? Dejará de procesar sus pedidos.`)) return
    setDeleting(storeId)
    try {
      const res = await fetch('/api/stores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      })
      if (res.ok) {
        onToast(`"${storeName}" desconectada`, 'success')
        fetchStores()
      } else {
        onToast('Error al desconectar', 'error')
      }
    } catch {
      onToast('Error de red', 'error')
    } finally {
      setDeleting(null)
    }
  }

  function handleConnect() {
    const name = newStoreName.trim()
    if (!name) return
    setModalOpen(false)
    setNewStoreName('')
    window.location.href = `/api/tn/connect?name=${encodeURIComponent(name)}`
  }

  return (
    <div className="space-y-6">

      {/* Modal: nombre de la tienda */}
      {modalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setModalOpen(false); setNewStoreName('') } }}
        >
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px 24px', width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              Conectar nueva tienda
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              Ingresá el nombre de la tienda antes de autorizar en TiendaNube.
            </p>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
              Nombre de la tienda
            </label>
            <input
              type="text"
              autoFocus
              placeholder="Ej: Deportes Norte"
              value={newStoreName}
              onChange={e => setNewStoreName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConnect() }}
              style={{ width: '100%', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '9px 12px', fontSize: '14px', color: '#1e293b', outline: 'none', boxSizing: 'border-box', marginBottom: '20px' }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setModalOpen(false); setNewStoreName('') }}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '13px', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConnect}
                disabled={!newStoreName.trim()}
                style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: newStoreName.trim() ? '#2563eb' : '#93c5fd', fontSize: '13px', fontWeight: 600, color: 'white', cursor: newStoreName.trim() ? 'pointer' : 'not-allowed' }}
              >
                Conectar con TiendaNube →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Tiendas conectadas</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Administrá las tiendas de TiendaNube que se sincronizan con MercadoPago
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition shadow-sm"
        >
          <span>+</span>
          Conectar tienda nueva
        </button>
      </div>

      {/* Stores list */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Cargando tiendas...</div>
      ) : stores.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center">
          <p className="text-slate-400 text-sm">No hay tiendas conectadas</p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            Conectar primera tienda
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map(store => (
            <div
              key={store.storeId}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 font-bold text-sm">
                    {store.storeName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{store.storeName}</p>
                    <p className="text-xs text-slate-400">ID: {store.storeId}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  Activa
                </span>
              </div>

              <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                Conectada el {fmtDate(store.connectedAt)}
              </div>

              <button
                onClick={() => handleDelete(store.storeId, store.storeName)}
                disabled={deleting === store.storeId}
                className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 text-left transition"
              >
                {deleting === store.storeId ? 'Desconectando...' : 'Desconectar'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">¿Cómo conectar una tienda?</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-600">
          <li>Hacé clic en "Conectar tienda nueva"</li>
          <li>Ingresá el nombre de la tienda</li>
          <li>El dueño de la tienda autoriza la app en TiendaNube</li>
          <li>La tienda queda activa automáticamente</li>
        </ol>
      </div>
    </div>
  )
}
