'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      setError('Usuario o contraseña incorrectos')
      setLoading(false)
    }
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
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{
              background: 'linear-gradient(135deg, #00d4ff20, #0070f320)',
              border: '1px solid rgba(0,212,255,0.3)',
              boxShadow: '0 0 30px rgba(0,212,255,0.2)',
            }}
          >
            <span className="text-2xl font-black text-cyan-400" style={{ textShadow: '0 0 20px rgba(0,212,255,0.8)' }}>CB</span>
          </motion.div>
          <h1 className="text-2xl font-bold text-white">CriptoBlue</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(0,212,255,0.6)' }}>Sistema de conciliación de pagos</p>
        </div>

        {/* Card */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="space-y-4 p-8 rounded-2xl relative"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '1px solid rgba(0,212,255,0.15)',
            boxShadow: '0 0 40px rgba(0,212,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(0,212,255,0.7)' }}>
              Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(0,212,255,0.15)',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(0,212,255,0.5)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,212,255,0.15)'}
              placeholder="Tu usuario"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(0,212,255,0.7)' }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(0,212,255,0.15)',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(0,212,255,0.5)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,212,255,0.15)'}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-center py-2 px-3 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              {error}
            </motion.p>
          )}

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all mt-2"
            style={{
              background: loading ? 'rgba(0,212,255,0.1)' : 'linear-gradient(135deg, #00d4ff, #0070f3)',
              boxShadow: loading ? 'none' : '0 0 20px rgba(0,212,255,0.3)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                Ingresando...
              </span>
            ) : 'Ingresar'}
          </motion.button>
        </motion.form>
      </motion.div>
    </div>
  )
}
