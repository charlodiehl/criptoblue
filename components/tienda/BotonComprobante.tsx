'use client'

// Botón para descargar el comprobante (de una transferencia pagada o un reembolso
// ejecutado). El href apunta al endpoint /api/tienda/comprobante[-reembolso], que
// redirige a la URL firmada. Se abre en pestaña nueva (PDF/imagen).
export default function BotonComprobante({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
      style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.18)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.1)')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
      </svg>
      Descargar comprobante
    </a>
  )
}
