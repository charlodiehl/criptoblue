'use client'

import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Gestión de equipo, compartida entre TIENDAS y BILLETERAS.
//
// Las dos pantallas hacen exactamente lo mismo —listar integrantes, prender y
// apagar permisos, dar de alta y de baja— y solo cambian en la lista de permisos,
// los endpoints y cómo se llama la entidad. Estaba duplicado y era cuestión de
// tiempo que una corrección entrara en una pantalla y no en la otra.
//
// El gating REAL lo hace el backend; acá solo se refleja para no confundir al
// usuario mostrándole controles que después van a fallar.
// ─────────────────────────────────────────────────────────────────────────────

export interface PermisoDef<K extends string> {
  key: K
  label: string
  descripcion: string
}

interface Miembro<K extends string> {
  email: string
  displayName: string | null
  permisos: Partial<Record<K, boolean>>
}
interface EquipoData<K extends string> {
  miembros: Miembro<K>[]
  yoEmail: string
  puedeGestionar: boolean
  soySuperAdmin: boolean
}

interface Props<K extends string> {
  /** Cómo se nombra la entidad en los textos: "la tienda" / "la billetera". */
  entidad: string
  /** Lista fija de permisos. El primero DEBE ser 'administracion' (implica todos). */
  permisos: PermisoDef<K>[]
  /** Base de los endpoints: '/api/tienda/equipo' | '/api/billetera/equipo'. */
  apiBase: string
  /** Query string del scope (vista espejo del admin / multi-acceso). */
  qs: string
  notify: (m: string, t?: 'success' | 'error' | 'info') => void
  /** Qué puede hacer todo integrante sin ningún permiso marcado. */
  notaAccesoBase?: string
}

export default function EquipoGestion<K extends string>({
  entidad, permisos: DEFS, apiBase, qs, notify, notaAccesoBase,
}: Props<K>) {
  type P = Partial<Record<K, boolean>>
  const ADMIN = 'administracion' as K
  // Todos los permisos en true: es lo que implica ser Administrador.
  const todos = (): P => Object.fromEntries(DEFS.map(d => [d.key, true])) as P

  const [data, setData] = useState<EquipoData<K> | null>(null)
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState<string | null>(null)
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoPerm, setNuevoPerm] = useState<P>({})
  const [agregando, setAgregando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}${qs}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error')
      setData(d)
    } catch (e) {
      notify(`No se pudo cargar el equipo: ${e instanceof Error ? e.message : e}`, 'error')
    } finally { setCargando(false) }
  }, [apiBase, qs, notify])

  useEffect(() => { cargar() }, [cargar])

  // ¿Se puede tocar ESTE toggle? Espeja las reglas del backend.
  function toggleBloqueado(m: Miembro<K>, key: K): boolean {
    if (!data) return true
    if (!data.puedeGestionar) return true                             // sin Administración: solo lectura
    if (m.email === data.yoEmail && !data.soySuperAdmin) return true  // no editar los propios
    // Administración: darla puede cualquier administrador; quitarla solo el Super Admin.
    if (key === ADMIN) return m.permisos[ADMIN] === true && !data.soySuperAdmin
    // Un Administrador tiene todos los permisos: los demás no se editan aparte.
    if (m.permisos[ADMIN] === true) return true
    return false
  }

  async function togglePermiso(m: Miembro<K>, key: K) {
    if (toggleBloqueado(m, key) || guardando) return
    const permisos: P = (key === ADMIN && m.permisos[ADMIN] !== true)
      ? todos()
      : { ...m.permisos, [key]: m.permisos[key] !== true }
    setGuardando(m.email)
    setData(d => d && ({ ...d, miembros: d.miembros.map(x => x.email === m.email ? { ...x, permisos } : x) }))
    try {
      const res = await fetch(`${apiBase}/permisos${qs}`, {
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

  // Espeja las reglas del backend: gestor, nunca a uno mismo, y a otro Administrador
  // solo el Super Admin.
  function puedeEliminar(m: Miembro<K>): boolean {
    if (!data?.puedeGestionar) return false
    if (m.email === data.yoEmail) return false
    if (m.permisos[ADMIN] === true && !data.soySuperAdmin) return false
    return true
  }

  async function eliminar(m: Miembro<K>) {
    if (eliminando) return
    if (!window.confirm(`¿Dar de baja a ${m.email}? Va a perder el acceso a ${entidad}.`)) return
    setEliminando(m.email)
    try {
      const res = await fetch(`${apiBase}/eliminar${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: m.email }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error')
      notify('Integrante dado de baja ✓', 'success')
      setExpandido(null)
      cargar()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo dar de baja', 'error')
    } finally { setEliminando(null) }
  }

  async function agregarMiembro() {
    if (agregando) return
    const email = nuevoEmail.trim().toLowerCase()
    if (!email) { notify('Ingresá el email', 'error'); return }
    setAgregando(true)
    try {
      const res = await fetch(`${apiBase}/agregar${qs}`, {
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
        {data.miembros.length === 0 && (
          <p className="text-sm py-4 text-center" style={{ color: 'rgba(148,163,184,0.45)' }}>
            Todavía no hay nadie con acceso a {entidad}.
          </p>
        )}
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
                    {DEFS.map(p => {
                      // Un Administrador tiene todos los permisos → todos sus toggles en ON.
                      const on = m.permisos[ADMIN] === true || m.permisos[p.key] === true
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
                    {puedeEliminar(m) && (
                      <div className="pt-2 mt-1" style={{ borderTop: '1px solid rgba(148,163,184,0.06)' }}>
                        <button onClick={() => eliminar(m)} disabled={eliminando === m.email}
                          className="w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', cursor: eliminando === m.email ? 'not-allowed' : 'pointer' }}>
                          {eliminando === m.email ? 'Dando de baja…' : '🗑 Dar de baja del equipo'}
                        </button>
                      </div>
                    )}
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
          : notaAccesoBase && (
            <div className="mb-1 rounded-lg px-3 py-2" style={{ background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.18)' }}>
              <p className="text-[11px] leading-snug" style={{ color: 'rgba(203,213,225,0.8)' }}>
                <span className="font-semibold" style={{ color: '#00ff88' }}>✓ Todos los integrantes ya pueden</span> {notaAccesoBase}
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
            {DEFS.map(p => {
              // Un Administrador tiene todo: si se marca, los otros quedan en ON y bloqueados.
              const esAdmin = nuevoPerm[ADMIN] === true
              const heredado = esAdmin && p.key !== ADMIN
              return (
                <label key={p.key} className="flex items-center gap-2 text-sm" style={{ color: 'rgba(226,232,240,0.85)', opacity: heredado ? 0.6 : 1, cursor: puede && !heredado ? 'pointer' : 'not-allowed' }}>
                  <input type="checkbox" disabled={!puede || agregando || heredado}
                    checked={p.key === ADMIN ? esAdmin : (esAdmin || nuevoPerm[p.key] === true)}
                    onChange={e => setNuevoPerm(v => ({ ...v, [p.key]: e.target.checked }))} />
                  {p.label}{p.key === ADMIN && <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>(tiene todos los permisos)</span>}
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
