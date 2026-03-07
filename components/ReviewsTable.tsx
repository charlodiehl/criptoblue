'use client'

import type { PendingMatch } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  matches: PendingMatch[]
  onApprove: (id: string) => void
  loading: string | null
}

export default function ReviewsTable({ matches, onApprove, loading }: Props) {
  if (matches.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        No hay pagos en revisión
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Pagador</th>
            <th className="px-4 py-2">Monto</th>
            <th className="px-4 py-2">Score</th>
            <th className="px-4 py-2">Pedido</th>
            <th className="px-4 py-2">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {matches.map(m => {
            const id = m.mpPaymentId || ''
            return (
              <tr key={id}>
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{fmtDate(m.matchedAt)}</td>
                <td className="px-4 py-2 text-slate-700">{m.payment.nombrePagador || m.payment.emailPagador}</td>
                <td className="px-4 py-2 font-semibold">{ARS.format(m.payment.monto)}</td>
                <td className="px-4 py-2 text-amber-600 font-semibold">{m.score}%</td>
                <td className="px-4 py-2 text-blue-600 font-semibold">#{m.order.orderNumber}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => onApprove(id)}
                    disabled={loading === id}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {loading === id ? '...' : 'Aprobar'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
