'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function TnSuccessContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('tn_error')

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
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Volvé a intentar desde el link, o avisale al administrador.
        </p>
      </div>
    )
  }

  return (
    <div className="text-center space-y-4 p-6 sm:p-8" style={{ maxWidth: 380, margin: '0 auto' }}>
      <div className="text-5xl">✅</div>
      <p className="text-xl font-semibold" style={{ color: '#00d4ff' }}>
        ¡Tienda conectada!
      </p>
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
        Ya quedó vinculada. No tenés que hacer nada más — podés cerrar esta pestaña.
      </p>
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
