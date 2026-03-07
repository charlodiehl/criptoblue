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

const ACTION_ICONS: Record<string, string> = {
  auto_paid: '✅',
  manual_paid: '💳',
  needs_review: '⚠️',
  no_match: '❌',
  dismissed: '🗑️',
  cancelled: '🚫',
}

const ACTION_COLORS: Record<string, string> = {
  auto_paid: 'text-emerald-600',
  manual_paid: 'text-blue-600',
  needs_review: 'text-amber-600',
  no_match: 'text-red-500',
  dismissed: 'text-slate-400',
  cancelled: 'text-slate-400',
}

export default function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const recent = [...entries].reverse().slice(0, 20)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
        <h3 className="font-semibold text-slate-700">Actividad reciente</h3>
      </div>
      {recent.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">Sin actividad registrada</div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
          {recent.map((e, i) => (
            <li key={i} className="flex items-start gap-3 px-5 py-2.5">
              <span className="text-base mt-0.5">{ACTION_ICONS[e.action] || '•'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-semibold ${ACTION_COLORS[e.action] || 'text-slate-500'}`}>
                    {e.action.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(e.timestamp)}</span>
                </div>
                <p className="text-sm text-slate-700 truncate">
                  {e.amount != null && ARS.format(e.amount)}
                  {e.orderNumber && ` → #${e.orderNumber}`}
                  {e.customerName && ` (${e.customerName})`}
                  {e.storeName && ` · ${e.storeName}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
