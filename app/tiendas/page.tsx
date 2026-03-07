'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import StoresTab from '@/components/StoresTab'
import { Suspense } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

function TiendasContent() {
  const searchParams = useSearchParams()
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdRef = useRef(0)

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    if (searchParams.get('success')) addToast('Tienda conectada correctamente', 'success')
    if (searchParams.get('error')) {
      const err = searchParams.get('error')
      const msgs: Record<string, string> = {
        no_code: 'No se recibió código de autorización',
        no_secret: 'Falta configurar CRIPTOBLUE_TN_CLIENT_SECRET',
        token_failed: 'Error al obtener el token de TiendaNube',
        token_error: 'Error de conexión con TiendaNube',
      }
      addToast(msgs[err!] || 'Error desconocido', 'error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg max-w-xs ${
              t.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1400px] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-sm">
                CB
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight">CriptoBlue</h1>
                <p className="text-xs text-slate-400 leading-tight">Conciliación de pagos MP / TN</p>
              </div>
            </a>
          </div>
          <a
            href="/"
            className="text-sm font-medium text-slate-500 hover:text-slate-700 transition"
          >
            ← Volver al dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <StoresTab onToast={addToast} />
      </main>
    </div>
  )
}

export default function TiendasPage() {
  return (
    <Suspense>
      <TiendasContent />
    </Suspense>
  )
}
