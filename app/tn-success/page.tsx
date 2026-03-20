'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function TnSuccessContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('tn_error')
  const storeId = searchParams.get('storeId')

  const [storeName, setStoreName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // En caso de error, cerrar automáticamente
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => window.close(), 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  async function handleSave() {
    const name = storeName.trim()
    if (!name || !storeId) return
    setSaving(true)
    try {
      await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, storeName: name }),
      })
      setSaved(true)
      setTimeout(() => window.close(), 1500)
    } catch {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="text-center space-y-4 p-8">
        <div className="text-5xl">❌</div>
        <p className="text-xl font-semibold" style={{ color: '#f87171' }}>
          Error al conectar la tienda
        </p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {error === 'no_secret' && 'Falta configuración del servidor'}
          {error === 'token_failed' && 'No se pudo obtener el token de TiendaNube'}
          {error === 'token_error' && 'Error de conexión con TiendaNube'}
          {!['no_secret', 'token_failed', 'token_error'].includes(error) && error}
        </p>
      </div>
    )
  }

  if (saved) {
    return (
      <div className="text-center space-y-4 p-8">
        <div className="text-5xl">✅</div>
        <p className="text-xl font-semibold" style={{ color: '#00d4ff' }}>
          ¡Tienda conectada!
        </p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Esta pestaña se cerrará en un momento...
        </p>
      </div>
    )
  }

  return (
    <div className="text-center space-y-6 p-8" style={{ maxWidth: 360, margin: '0 auto' }}>
      <div className="text-5xl">🏪</div>
      <div>
        <p className="text-xl font-semibold" style={{ color: '#00d4ff' }}>
          ¡Tienda conectada!
        </p>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          ¿Cómo querés llamar a esta tienda?
        </p>
      </div>
      <input
        type="text"
        autoFocus
        value={storeName}
        onChange={e => setStoreName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSave()}
        placeholder="Nombre de la tienda"
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid rgba(0,212,255,0.3)',
          background: 'rgba(255,255,255,0.05)',
          color: 'white',
          fontSize: 15,
          outline: 'none',
        }}
      />
      <button
        onClick={handleSave}
        disabled={!storeName.trim() || saving}
        style={{
          width: '100%',
          padding: '11px',
          borderRadius: 10,
          border: 'none',
          background: storeName.trim() && !saving ? 'linear-gradient(135deg, #00c851, #00a844)' : 'rgba(255,255,255,0.1)',
          color: 'white',
          fontSize: 15,
          fontWeight: 700,
          cursor: storeName.trim() && !saving ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Guardando...' : 'Guardar nombre'}
      </button>
    </div>
  )
}

export default function TnSuccess() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#0d1117' }}
    >
      <Suspense fallback={<div className="text-5xl animate-pulse">⏳</div>}>
        <TnSuccessContent />
      </Suspense>
    </div>
  )
}
