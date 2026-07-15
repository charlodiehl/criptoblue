'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ARS } from '@/lib/utils'
import type { Toast } from './FinanzasApp'

interface MetricaTienda { storeId: string; storeName: string; netoUsdt: number; comisionArs: number; ordenes: number }
interface MetricaBilletera { wallet: string; netoArs: number }
interface MetricaReembolsos { storeId: string; storeName: string; cantidad: number }
interface Metricas {
  desde: string; hasta: string
  ordenesTotal: number; saldoTiendasUsdt: number; saldoTiendasArs: number | null; cotizacion: number | null
  saldoBilleterasArs: number; reembolsosTotal: number
  tiendas: MetricaTienda[]; billeteras: MetricaBilletera[]; reembolsosPorTienda: MetricaReembolsos[]
}

const PALETA = ['#00d4ff', '#00ff88', '#fbbf24', '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#34d399', '#c084fc', '#facc15', '#2dd4bf', '#f87171']
const fmtUsdt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT'
const inputStyle: React.CSSProperties = {
  fontSize: '13px', padding: '8px 11px', borderRadius: '9px', colorScheme: 'dark',
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.18)', color: 'rgba(226,232,240,0.92)', outline: 'none',
}

// "YYYY-MM-DDTHH:mm" en hora Argentina a partir de un instante (ms).
function artLocal(ms: number): string {
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export default function MetricasTab({ notify }: { notify: (msg: string, type?: Toast['type']) => void }) {
  // Default: desde el 1 de julio de 2026 hasta el momento en que se abre la pestaña.
  const [desde, setDesde] = useState('2026-07-01T00:00')
  const [hasta, setHasta] = useState(() => artLocal(Date.now()))
  const [data, setData] = useState<Metricas | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMetricas = useCallback(async (d: string, h: string) => {
    setLoading(true)
    try {
      const q = (v: string) => encodeURIComponent(`${v}:00-03:00`)
      const res = await fetch(`/api/finanzas/metricas?desde=${q(d)}&hasta=${q(h)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      setData(await res.json())
    } catch (e) {
      notify(`No se pudieron cargar las métricas: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  // Carga inicial: período por defecto (1 de julio de 2026 → ahora).
  useEffect(() => { fetchMetricas(desde, hasta) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function aplicar() {
    if (`${hasta}:00-03:00` <= `${desde}:00-03:00`) { notify('La fecha "hasta" debe ser posterior a "desde"', 'error'); return }
    fetchMetricas(desde, hasta)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#00d4ff' }}>Métricas</h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(148,163,184,0.5)' }}>Todo lo de abajo corresponde al período seleccionado. Por defecto, desde el 1 de julio de 2026 hasta ahora.</p>
      </div>

      {/* Selector de período */}
      <div className="rounded-2xl p-4 flex items-end gap-3 flex-wrap" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.15)' }}>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(0,212,255,0.7)' }}>Desde</label>
          <input type="datetime-local" style={inputStyle} value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(0,212,255,0.7)' }}>Hasta</label>
          <input type="datetime-local" style={inputStyle} value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <button onClick={aplicar} disabled={loading}
          className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #00d4ff, #0070f3)', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Calculando…' : 'Aplicar'}
        </button>
      </div>

      {loading && !data ? (
        <p className="text-sm py-10 text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>Calculando métricas…</p>
      ) : !data ? null : (
        <>
          {/* Tarjetas */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Tarjeta titulo="Órdenes emparejadas" valor={String(data.ordenesTotal)} color="#00d4ff"
              detalle={`en ${data.tiendas.filter(t => t.ordenes > 0).length} tienda${data.tiendas.filter(t => t.ordenes > 0).length === 1 ? '' : 's'}`} />
            <Tarjeta titulo="Saldo adeudado a las tiendas" valor={fmtUsdt(data.saldoTiendasUsdt)} color="#00ff88"
              estimado={data.saldoTiendasArs != null ? `≈ ${ARS.format(data.saldoTiendasArs)}` : undefined}
              detalle={data.cotizacion != null
                ? `cambio neto del período · estimado a ${ARS.format(data.cotizacion)}/USDT (última cotización)`
                : 'cambio neto del período · cotización no disponible'} />
            <Tarjeta titulo="Saldo que nos deben las billeteras" valor={ARS.format(data.saldoBilleterasArs)} color="#fbbf24"
              detalle="cambio neto del período (todas sumadas)" />
          </div>

          {/* Gráficos */}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <Panel titulo="Saldo adeudado a cada tienda">
              <BarrasHorizontales items={data.tiendas.map((t, i) => ({ label: t.storeName, value: t.netoUsdt, color: PALETA[i % PALETA.length] }))}
                fmt={fmtUsdt} />
            </Panel>

            <Panel titulo="Contribución de cada tienda al aumento del saldo adeudado">
              <BarrasPct items={data.tiendas.map((t, i) => ({ label: t.storeName, value: t.netoUsdt, color: PALETA[i % PALETA.length] }))} />
            </Panel>

            <Panel titulo="Saldo que nos debe cada billetera">
              <BarrasHorizontales items={data.billeteras.map((b, i) => ({ label: b.wallet, value: b.netoArs, color: PALETA[i % PALETA.length] }))}
                fmt={ARS.format} mostrarTodos />
            </Panel>

            <Panel titulo="Comisión que aportó cada tienda">
              <Torta items={data.tiendas
                .filter(t => t.comisionArs > 0)
                .sort((a, b) => b.comisionArs - a.comisionArs)   // primero los que más aportaron
                .map((t, i) => ({ label: t.storeName, value: t.comisionArs, color: PALETA[i % PALETA.length] }))} />
            </Panel>

            <Panel titulo="Reembolsos solicitados por tienda">
              {data.reembolsosPorTienda.length === 0
                ? <Vacio texto="Sin reembolsos solicitados en el período" />
                : <BarrasHorizontales items={data.reembolsosPorTienda.map((r, i) => ({ label: r.storeName, value: r.cantidad, color: PALETA[i % PALETA.length] }))}
                    fmt={(n) => String(n)} enteros />}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Tarjeta({ titulo, valor, detalle, color, estimado }: { titulo: string; valor: string; detalle: string; color: string; estimado?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: `1px solid ${color}33` }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.7)' }}>{titulo}</p>
      <p className="text-2xl font-black" style={{ color }}>{valor}</p>
      {estimado && <p className="text-sm font-bold mt-0.5" style={{ color: 'rgba(226,232,240,0.75)' }}>{estimado}</p>}
      <p className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.5)' }}>{detalle}</p>
    </motion.div>
  )
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0d1117, #111827)', border: '1px solid rgba(0,212,255,0.12)' }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(0,212,255,0.8)' }}>{titulo}</h3>
      {children}
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="text-sm py-6 text-center" style={{ color: 'rgba(148,163,184,0.45)' }}>{texto}</p>
}

// Contribución al AUMENTO del saldo adeudado. Solo cuentan las tiendas que aumentaron
// la deuda en el período (neto > 0); su % es su parte del total del aumento, comparando
// solo entre ellas. Las que redujeron o mantuvieron el saldo no figuran (aportan 0%).
function BarrasPct({ items }: { items: { label: string; value: number; color: string }[] }) {
  const positivos = items.filter(i => i.value > 0.005).sort((a, b) => b.value - a.value)
  const totalPos = positivos.reduce((s, i) => s + i.value, 0)
  if (positivos.length === 0 || totalPos === 0) return <Vacio texto="Ninguna tienda aumentó el saldo en el período" />
  const max = positivos[0].value
  return (
    <div className="space-y-2.5">
      {positivos.map(i => (
        <div key={i.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: 'rgba(226,232,240,0.85)' }}>{i.label}</span>
            <span className="font-semibold" style={{ color: '#00ff88' }}>{((i.value / totalPos) * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: i.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Barras horizontales con el valor (ancho relativo al mayor absoluto). Con
// `mostrarTodos` se listan todos los ítems aunque estén en cero (para las billeteras:
// se quiere ver siempre las 4, con su saldo actual, aunque en el período sea $0).
function BarrasHorizontales({ items, fmt, enteros, mostrarTodos }: { items: { label: string; value: number; color: string }[]; fmt: (n: number) => string; enteros?: boolean; mostrarTodos?: boolean }) {
  const conValor = mostrarTodos ? items : items.filter(i => enteros ? i.value !== 0 : Math.abs(i.value) > 0.005)
  if (conValor.length === 0) return <Vacio texto="Sin datos en el período" />
  const maxAbs = Math.max(...conValor.map(i => Math.abs(i.value)), 1)  // ≥1 evita ancho NaN si todo es 0
  return (
    <div className="space-y-2.5">
      {conValor.map(i => (
        <div key={i.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: 'rgba(226,232,240,0.85)' }}>{i.label}</span>
            <span className="font-semibold" style={{ color: i.value < 0 ? '#f87171' : 'rgba(226,232,240,0.9)' }}>{fmt(i.value)}</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (Math.abs(i.value) / maxAbs) * 100)}%`, background: i.value < 0 ? '#f87171' : i.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Gráfico de torta con conic-gradient + leyenda. `items` ya viene ordenado desc
// (los que más aportaron primero): así el dibujo arranca desde arriba con el mayor
// y la leyenda los nombra del que más al que menos. Muestra el MONTO (no %).
function Torta({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0) return <Vacio texto="Sin comisiones en el período" />
  // Ángulos acumulados sin mutar variables durante el render.
  const stops = items.map((i, idx) => {
    const previo = items.slice(0, idx).reduce((s, x) => s + x.value, 0)
    return `${i.color} ${(previo / total) * 360}deg ${((previo + i.value) / total) * 360}deg`
  }).join(', ')
  const fmtNum = (n: number) => '$ ' + Math.round(n).toLocaleString('es-AR')
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="shrink-0 rounded-full" style={{ width: 150, height: 150, background: `conic-gradient(${stops})` }} />
      <div className="space-y-1.5 min-w-0">
        {items.map(i => (
          <div key={i.label} className="flex items-center gap-2 text-xs">
            <span className="shrink-0" style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }} />
            <span className="truncate" style={{ color: 'rgba(226,232,240,0.85)' }}>{i.label}</span>
            <span className="whitespace-nowrap ml-auto font-semibold" style={{ color: 'rgba(226,232,240,0.9)' }}>{fmtNum(i.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
