'use client'

import type { LogEntry } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const ACTION_CONFIG = {
  auto_paid: { label: 'Auto pagado', color: 'bg-emerald-100 text-emerald-700' },
  manual_paid: { label: 'Pagado manual', color: 'bg-blue-100 text-blue-700' },
  needs_review: { label: 'En revisión', color: 'bg-amber-100 text-amber-700' },
  no_match: { label: 'Sin match', color: 'bg-red-100 text-red-600' },
  dismissed: { label: 'Descartado', color: 'bg-slate-100 text-slate-500' },
  cancelled: { label: 'Cancelado', color: 'bg-slate-100 text-slate-500' },
}

export default function TransferenciasTable({ entries }: { entries: LogEntry[] }) {
  const recent = [...entries].reverse().slice(0, 50)

  if (recent.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
        <p className="text-4xl mb-2">📋</p>
        <p className="text-slate-600 font-medium">Sin actividad registrada</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Pagador</th>
              <th className="px-4 py-3">Monto</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Tienda</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recent.map((e, i) => {
              const cfg = ACTION_CONFIG[e.action] || { label: e.action, color: 'bg-slate-100 text-slate-500' }
              return (
                <tr key={i} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(e.timestamp)}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[150px] truncate">
                    {e.payment?.nombrePagador || e.payment?.emailPagador || '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                    {e.amount != null ? ARS.format(e.amount) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {e.score != null ? `${e.score}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-blue-600 font-semibold">
                    {e.orderNumber ? `#${e.orderNumber}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[150px] truncate">
                    {e.customerName || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {e.storeName || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
