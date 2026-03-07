'use client'

import type { Order } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  orders: Order[]
  onMarkPaid: (storeId: string, orderId: string) => Promise<void>
  onCancel: (storeId: string, orderId: string) => Promise<void>
  loading: boolean
}

export default function OrdersTable({ orders, onMarkPaid, onCancel, loading }: Props) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
        <p className="text-4xl mb-2">📦</p>
        <p className="text-slate-600 font-medium">No hay pedidos pendientes</p>
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
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Monto</th>
              <th className="px-4 py-3">Pedido #</th>
              <th className="px-4 py-3">Tienda</th>
              <th className="px-4 py-3">Gateway</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map(o => (
              <tr key={`${o.storeId}-${o.orderId}`} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{o.customerName || '—'}</p>
                  <p className="text-xs text-slate-400 truncate max-w-[160px]">{o.customerEmail}</p>
                </td>
                <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{ARS.format(o.total)}</td>
                <td className="px-4 py-3 font-semibold text-blue-600">#{o.orderNumber}</td>
                <td className="px-4 py-3 text-slate-500">{o.storeName}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{o.gateway}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => onMarkPaid(o.storeId, o.orderId)}
                      disabled={loading}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition whitespace-nowrap"
                    >
                      Marcar pagado
                    </button>
                    <button
                      onClick={() => onCancel(o.storeId, o.orderId)}
                      disabled={loading}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
