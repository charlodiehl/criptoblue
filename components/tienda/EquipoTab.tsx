'use client'

import { useState, useEffect, useCallback } from 'react'
import { PERMISOS, type PermisoKey, type Permisos } from '@/lib/permisos'
import type { Toast } from './TiendaPortal'

// Sección "Equipo" del portal de tienda: integrantes con acceso + sus permisos.
// Cada fila se despliega y muestra los permisos como toggles. Editar/agregar solo si
// el usuario tiene Administración (data.puedeGestionar); si no, todo se ve bloqueado.
// El gating REAL lo hace el backend — acá solo se refleja para no confundir al usuario.

interface Miembro { email: string; displayName: string | null; permisos: Permisos }
interface EquipoData { miembros: Miembro[]; yoEmail: string; puedeGestionar: boolean; soySuperAdmin: boolean }

export default function EquipoTab({ qs, notify }: { qs: string; notify: (m: string, t?: Toast['type']) => void }) {
  const [data, setData] = useState<EquipoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  // Alta de miembro
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoPerm, setNuevoPerm] = useState<Permisos>({})
  const [agregando, setAgregando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/tienda/equipo${qs}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error')
      setData(d)
    } catch (e) {
      notify(`No se pudo cargar el equipo: ${e instanceof Error ? e.message : e}`, 'error')
    } finally { setCargando(false) }
  }, [qs, notify])

  useEffect(() => { cargar() }, [cargar])

  // ¿Se puede tocar ESTE toggle? Espeja las reglas del backend.
  function toggleBloqueado(m: Miembro, key: PermisoKey): boolean {
    if (!data) return true
    if (!data.puedeGestionar) return true                             // sin Administración: solo lectura
    if (m.email === data.yoEmail && !data.soySuperAdmin) return true  // no editar los propios
    // Administración: dar sí (cualquier admin de tienda); quitar solo el Super Admin.
    if (key === 'administracion') return m.permisos.administracion === true && !data.soySuperAdmin
    // Un Administrador tiene todos los permisos: transferencias/reembolsos no se editan aparte.
    if (m.permisos.administracion === true) return true
    return false
  }

  async function togglePermiso(m: Miembro, key: PermisoKey) {
    if (toggleBloqueado(m, key) || guardando) return
    // Activar Administración otorga todos los permisos.
    const permisos: Permisos = (key === 'administracion' && m.permisos.administracion !== true)
      ? { administracion: true, solicitar_transferencias: true, solicitar_reembolsos: true }
      : { ...m.permisos, [key]: m.permisos[key] !== true }
    setGuardando(m.email)
    // optimista
    setData(d => d && ({ ...d, miembros: d.miembros.map(x => x.email === m.email ? { ...x, permisos } : x) }))
    try {
      const res = await fetch(`/api/tienda/equipo/permisos${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: m.email, permisos }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      cargar()   // revertir al estado real
    } finally { setGuardando(null) }
  }

  async function agregarMiembro() {
    if (agregando) return
    const email = nuevoEmail.trim().toLowerCase()
    if (!email) { notify('Ingresá el email', 'error'); return }
    setAgregando(true)
    try {
      const res = await fetch(`/api/tienda/equipo/agregar${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, permisos: nuevoPerm }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error')
      notify('Integrante agregado ✓', 'success')
      setNuevoEmail(''); setNuevoPerm({})
      cargar()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo agregar', 'error')
    } finally { setAgregando(false) }
  }

  if (cargando) return <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Cargando…</p>
  if (!data) return null
  const puede = data.puedeGestionar

  return (
    <div className="space-y-5">
      {/* Lista de integrantes */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(0,212,255,0.7)' }}>
          Integrantes con acceso ({data.miembros.length})
        </h3>
        <div className="space-y-2">
          {data.miembros.map(m => {
            const abierto = expandido === m.email
            const soyYo = m.email === data.yoEmail
            return (
              <div key={m.email} className="rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
                <button onClick={() => setExpandido(abierto ? null : m.email)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left transition-all">
                  <span className="text-sm min-w-0 truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>
                    {m.email}{soyYo && <span className="text-[11px] ml-2" style={{ color: 'rgba(0,212,255,0.6)' }}>(vos)</span>}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: 'rgba(148,163,184,0.5)' }}>{abierto ? '▲' : '▼'}</span>
                </button>
                {abierto && (
                  <div className="px-4 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(148,163,184,0.06)' }}>
                    {PERMISOS.map(p => {
                      // Un Administrador tiene todos los permisos → todos sus toggles en ON.
                      const on = m.permisos.administracion === true || m.permisos[p.key] === true
                      const bloqueado = toggleBloqueado(m, p.key)
                      return (
                        <div key={p.key} className="flex items-start justify-between gap-3 py-1.5">
                          <div className="min-w-0">
                            <p className="text-sm" style={{ color: 'rgba(226,232,240,0.88)' }}>{p.label}</p>
                            <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'rgba(148,163,184,0.55)' }}>{p.descripcion}</p>
                          </div>
                          <button onClick={() => togglePermiso(m, p.key)} disabled={bloqueado || guardando === m.email}
                            aria-pressed={on}
                            className="relative rounded-full transition-all shrink-0 mt-0.5 disabled:opacity-40"
                            style={{ width: '38px', height: '22px', background: on ? '#00ff88' : 'rgba(148,163,184,0.25)', cursor: bloqueado ? 'not-allowed' : 'pointer' }}
                            title={bloqueado ? 'No podés cambiar este permiso' : undefined}>
                            <span className="absolute rounded-full transition-all" style={{ width: '16px', height: '16px', top: '3px', left: on ? '19px' : '3px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Agregar integrante — bloqueado si no tenés Administración */}
      <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)', opacity: puede ? 1 : 0.5 }}>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(0,212,255,0.7)' }}>Agregar integrante</h3>
        {!puede
          ? <p className="text-[12px] mb-2" style={{ color: 'rgba(148,163,184,0.55)' }}>Solo los integrantes con Administración pueden agregar miembros.</p>
          : (
            <div className="mb-1 rounded-lg px-3 py-2" style={{ background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.18)' }}>
              <p className="text-[11px] leading-snug" style={{ color: 'rgba(203,213,225,0.8)' }}>
                <span className="font-semibold" style={{ color: '#00ff88' }}>✓ Todos los integrantes ya pueden</span> buscar pagos y ver el registro. No hace falta activarlo.
              </p>
            </div>
          )}
        <div className="space-y-3 mt-2">
          <input type="email" value={nuevoEmail} onChange={e => setNuevoEmail(e.target.value)} disabled={!puede || agregando}
            placeholder="email@ejemplo.com"
            className="w-full rounded-xl px-3 py-2.5 text-sm disabled:opacity-50"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none' }} />
          {puede && (
            <div className="pt-1">
              <p className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#00d4ff' }}>
                <span>➕</span> Permisos adicionales
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>Tildá lo que este integrante va a poder hacer <span style={{ color: 'rgba(203,213,225,0.75)' }}>además</span> del acceso base.</p>
            </div>
          )}
          <div className="space-y-1.5">
            {PERMISOS.map(p => {
              // Un Administrador tiene todo: si se marca, los otros quedan en ON y bloqueados.
              const esAdmin = nuevoPerm.administracion === true
              const heredado = esAdmin && p.key !== 'administracion'
              return (
                <label key={p.key} className="flex items-center gap-2 text-sm" style={{ color: 'rgba(226,232,240,0.85)', opacity: heredado ? 0.6 : 1, cursor: puede && !heredado ? 'pointer' : 'not-allowed' }}>
                  <input type="checkbox" disabled={!puede || agregando || heredado}
                    checked={p.key === 'administracion' ? esAdmin : (esAdmin || nuevoPerm[p.key] === true)}
                    onChange={e => setNuevoPerm(v => ({ ...v, [p.key]: e.target.checked }))} />
                  {p.label}{p.key === 'administracion' && <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>(tiene todos los permisos)</span>}
                </label>
              )
            })}
          </div>
          <button onClick={agregarMiembro} disabled={!puede || agregando}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: !puede || agregando ? 'not-allowed' : 'pointer' }}>
            {agregando ? 'Agregando…' : 'Agregar integrante'}
          </button>
        </div>
      </div>
    </div>
  )
}
