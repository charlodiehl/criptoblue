'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createSupabaseBrowser } from '@/lib/auth/client'

type Mode = 'cargando' | 'enrolar' | 'verificar'

// Configuración / verificación del 2FA (TOTP, obligatorio para todos los roles).
//  - Primer ingreso: genera el QR para la app de autenticación y verifica el código.
//  - Ingresos siguientes: pide el código de 6 dígitos (challenge) para subir a AAL2.
// Al completar redirige a /auth/redirect (server decide /  o /tienda según rol),
// con recarga completa para que el middleware vea el AAL2 nuevo.
export default function MfaPage() {
  const supabase = useRef(createSupabaseBrowser()).current
  const [mode, setMode] = useState<Mode>('cargando')
  const [factorId, setFactorId] = useState<string>('')
  const [qr, setQr] = useState<string>('')       // data URL (SVG) del QR
  const [secret, setSecret] = useState<string>('') // secreto manual (fallback del QR)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }

      // ¿Ya está en AAL2? Directo a la app.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel === 'aal2') { window.location.href = '/auth/redirect'; return }

      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
      if (fErr) { setError(fErr.message); return }

      const verificado = factors?.totp?.find(f => f.status === 'verified')
      if (verificado) {
        // Ya tiene 2FA configurado → solo pedir el código.
        setFactorId(verificado.id)
        setMode('verificar')
        return
      }

      // Primer ingreso: limpiar enrolamientos abandonados (factores sin verificar)
      // para poder enrolar de cero sin conflicto de nombre.
      const sinVerificar = (factors?.all ?? []).filter(f => f.status === 'unverified')
      for (const f of sinVerificar) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})
      }

      const { data: enrolled, error: eErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'CriptoBlue',
      })
      if (eErr || !enrolled) { setError(eErr?.message || 'No se pudo iniciar la configuración del 2FA'); return }
      setFactorId(enrolled.id)
      setQr(enrolled.totp.qr_code)
      setSecret(enrolled.totp.secret)
      setMode('enrolar')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verificar() {
    if (code.length !== 6 || loading) return
    setLoading(true)
    setError('')
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (vErr) {
      setError('Código incorrecto. Probá de nuevo.')
      setCode('')
      setLoading(false)
      return
    }
    window.location.href = '/auth/redirect'
  }

  // Auto-enviar apenas se completan los 6 dígitos (sin tener que tocar "Verificar").
  useEffect(() => {
    if (code.length === 6 && !loading) verificar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0a1628 0%, #060b14 60%)' }}>

      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, #00d4ff 0%, transparent 70%)', filter: 'blur(80px)' }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="text-center mb-6">
          <img src="/logo.png" alt="CriptoBlue" className="w-14 h-14 rounded-xl object-cover inline-block mb-3"
            style={{ boxShadow: '0 0 30px rgba(0,212,255,0.35)' }} />
          <h1 className="text-xl font-bold text-white">
            {mode === 'enrolar' ? 'Configurá tu 2FA' : 'Verificación en dos pasos'}
          </h1>
          <p className="text-xs mt-1" style={{ color: 'rgba(0,212,255,0.6)' }}>
            {mode === 'enrolar'
              ? 'Obligatorio para usar la aplicación'
              : 'Ingresá el código de tu app de autenticación'}
          </p>
        </div>

        <div className="p-6 rounded-2xl space-y-4"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.15)',
            boxShadow: '0 0 40px rgba(0,212,255,0.08)',
          }}
        >
          {mode === 'cargando' && !error && (
            <p className="text-sm text-center py-6" style={{ color: 'rgba(226,232,240,0.5)' }}>Cargando…</p>
          )}

          {mode === 'enrolar' && (
            <>
              <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: 'rgba(226,232,240,0.65)' }}>
                <li>Abrí tu app de autenticación (Google Authenticator, Authy, 1Password…)</li>
                <li>Escaneá este código QR</li>
                <li>Ingresá el código de 6 dígitos que te muestra</li>
              </ol>
              {qr && (
                <div className="flex justify-center">
                  <img src={qr} alt="QR 2FA" className="w-44 h-44 rounded-lg bg-white p-2" />
                </div>
              )}
              {secret && (
                <p className="text-[10px] text-center break-all" style={{ color: 'rgba(226,232,240,0.35)' }}>
                  ¿No podés escanear? Clave manual: <span className="font-mono">{secret}</span>
                </p>
              )}
            </>
          )}

          {(mode === 'enrolar' || mode === 'verificar') && (
            <form onSubmit={e => { e.preventDefault(); verificar() }} className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                placeholder="000000"
                className="w-full rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-white outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,212,255,0.2)' }}
              />
              {error && (
                <p className="text-xs text-center py-2 px-3 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={code.length !== 6 || loading}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{
                  background: code.length === 6 && !loading ? 'linear-gradient(135deg, #00d4ff, #0070f3)' : 'rgba(0,212,255,0.1)',
                  boxShadow: code.length === 6 && !loading ? '0 0 20px rgba(0,212,255,0.3)' : 'none',
                  cursor: code.length === 6 && !loading ? 'pointer' : 'not-allowed',
                }}
              >
                {loading ? 'Verificando…' : mode === 'enrolar' ? 'Activar 2FA' : 'Verificar'}
              </button>
            </form>
          )}

          {mode === 'cargando' && error && (
            <p className="text-xs text-center py-2 px-3 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              {error}
            </p>
          )}

          <button
            onClick={handleLogout}
            className="w-full text-[11px] text-center pt-1"
            style={{ color: 'rgba(226,232,240,0.35)', cursor: 'pointer' }}
          >
            ← Salir e ingresar con otra cuenta
          </button>
        </div>
      </motion.div>
    </div>
  )
}
