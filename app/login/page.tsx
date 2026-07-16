'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { createSupabaseBrowser } from '@/lib/auth/client'

// Login con Google (Supabase Auth). El acceso real lo deciden app_users + 2FA:
//  - email sin rol → /login?blocked=1 (pantalla de bloqueo, nada más)
//  - email con rol → /auth/mfa (enrolar o verificar el 2FA) → app según rol
function LoginInner() {
  const params = useSearchParams()
  const blocked = params.get('blocked') === '1'
  const oauthError = params.get('error') === 'oauth'
  const [loading, setLoading] = useState(false)

  // Si llegó bloqueado con una sesión colgada (p. ej. rol quitado después de
  // loguearse), cerrarla en silencio para que el próximo intento arranque limpio.
  useEffect(() => {
    if (blocked) createSupabaseBrowser().auth.signOut()
  }, [blocked])

  async function handleGoogle() {
    setLoading(true)
    const supabase = createSupabaseBrowser()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    // Redirige a Google — no hace falta resetear loading.
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0a1628 0%, #060b14 60%)' }}>

      {/* Ambient glow blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, #00d4ff 0%, transparent 70%)', filter: 'blur(80px)' }} />

      {/* Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{ backgroundImage: 'linear-gradient(#00d4ff 1px, transparent 1px), linear-gradient(90deg, #00d4ff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-block mb-4"
          >
            <img src="/logo.png" alt="CriptoBlue" className="w-20 h-20 rounded-2xl object-cover"
              style={{ boxShadow: '0 0 40px rgba(0,212,255,0.4), 0 0 80px rgba(0,212,255,0.15)' }} />
          </motion.div>
          <h1 className="text-2xl font-bold text-white">CriptoBlue</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(0,212,255,0.6)' }}>Sistema de conciliación de pagos</p>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="p-6 sm:p-8 rounded-2xl relative"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.15)',
            boxShadow: '0 0 40px rgba(0,212,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {blocked ? (
            <div className="text-center space-y-3 py-2">
              <div className="text-4xl">🚫</div>
              <p className="text-sm font-semibold text-white">No tenés permiso para acceder</p>
              <p className="text-xs" style={{ color: 'rgba(226,232,240,0.55)' }}>
                Comunicate con un administrador.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {oauthError && (
                <p className="text-xs text-center py-2 px-3 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  Hubo un problema con el ingreso. Probá de nuevo.
                </p>
              )}
              <motion.button
                onClick={handleGoogle}
                disabled={loading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-3"
                style={{
                  background: loading ? 'rgba(255,255,255,0.06)' : '#ffffff',
                  color: loading ? 'rgba(226,232,240,0.5)' : '#1f2937',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 0 20px rgba(0,212,255,0.25)',
                }}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    Redirigiendo...
                  </>
                ) : (
                  <>
                    {/* Logo Google */}
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.3-.1-2.6-.4-3.9z"/>
                      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 5.1 29.3 3 24 3 15.9 3 8.9 7.6 6.3 14.7z"/>
                      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.2 26.7 37 24 37c-5.2 0-9.6-3.3-11.3-8l-6.5 5C8.9 40.4 15.9 45 24 45z"/>
                      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 45 30 45 24c0-1.3-.1-2.6-.4-3.9z"/>
                    </svg>
                    Continuar con Google
                  </>
                )}
              </motion.button>
              <p className="text-[11px] text-center" style={{ color: 'rgba(226,232,240,0.4)' }}>
                Solo cuentas autorizadas. Se requiere verificación en dos pasos.
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
}

export default function LoginPage() {
  // useSearchParams exige Suspense en Next con prerender estático.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
