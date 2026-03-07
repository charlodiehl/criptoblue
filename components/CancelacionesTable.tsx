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

function getAgeHours(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / 3600000
}

interface Props {
  orders: Order[]
  onCancel: (storeId: string, orderId: string) => Promise<void>
  loading: boolean
}

export default function CancelacionesTable({ orders, onCancel, loading }: Props) {
  const stale = orders.filter(o => getAgeHours(o.createdAt) >= 48)

  if (stale.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
        <p className="text-4xl mb-2">🎉</p>
        <p className="text-slate-600 font-medium">No hay órdenes para cancelar</p>
        <p className="text-sm text-slate-400 mt-1">Solo se muestran órdenes con más de 48 horas sin pago</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-amber-50 px-5 py-3">
        <p className="text-sm font-semibold text-amber-700">
          {stale.length} orden{stale.length !== 1 ? 'es' : ''} con más de 48h sin pago
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Creada</th>
              <th className="px-4 py-3">Antigüedad</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Monto</th>
              <th className="px-4 py-3">Pedido #</th>
              <th className="px-4 py-3">Tienda</th>
              <th className="px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stale.map(o => {
              const hours = Math.round(getAgeHours(o.createdAt))
              return (
                <tr key={`${o.storeId}-${o.orderId}`} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${hours >= 72 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {hours}h
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{o.customerName || '—'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{ARS.format(o.total)}</td>
                  <td className="px-4 py-3 font-semibold text-blue-600">#{o.orderNumber}</td>
                  <td className="px-4 py-3 text-slate-500">{o.storeName}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onCancel(o.storeId, o.orderId)}
                      disabled={loading}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                    >
                      Cancelar pedido
                    </button>
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
