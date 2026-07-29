'use client'

// Piezas compartidas por los modales de detalle (transferencias y reembolsos).
// Están acá y no duplicadas en cada uno para que un retoque de estilo caiga en los
// dos: son la misma pantalla con distinto contenido.

export function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(148,163,184,0.1)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-2.5" style={{ color: 'rgba(0,212,255,0.7)' }}>{titulo}</p>
      {children}
    </div>
  )
}

export function Linea({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="shrink-0" style={{ color: 'rgba(148,163,184,0.65)' }}>{label}</span>
      <span className="text-right break-all font-medium" style={{ color: 'rgba(226,232,240,0.92)' }}>{valor}</span>
    </div>
  )
}

// Botón "i" que abre el detalle. Mismo control en la lista de transferencias y en
// la de reembolsos: si cambia, cambia en las dos.
export function BotonDetalle({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Ver detalles" title="Ver detalles"
      className="flex items-center justify-center rounded-lg transition-all shrink-0"
      style={{ width: 30, height: 30, background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: 'pointer' }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.6" />
      </svg>
    </button>
  )
}
