'use client'

import { useState } from 'react'
import type { UnmatchedPayment, Order } from '@/lib/types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  unmatchedPayments: UnmatchedPayment[]
  orders: Order[]
  onManualMatch: (mpPaymentId: string, orderId: string, storeId: string) => Promise<void>
  onDismissPayment: (mpPaymentId: string) => Promise<void>
  onMarkOrderPaid: (storeId: string, orderId: string) => Promise<void>
  loading: boolean
}

export default function ManualMatchTab({
  unmatchedPayments,
  orders,
  onManualMatch,
  onDismissPayment,
  onMarkOrderPaid,
  loading,
}: Props) {
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)

  const selPayment = unmatchedPayments.find(u => u.mpPaymentId === selectedPayment)
  const selOrder = orders.find(o => o.orderId === selectedOrder)

  const isAmountSimilar = (order: Order) => {
    if (!selPayment) return false
    return Math.abs(selPayment.payment.monto - order.total) <= 1000
  }

  const handleConfirm = async () => {
    if (!selPayment || !selOrder) return
    await onManualMatch(selPayment.mpPaymentId!, selOrder.orderId, selOrder.storeId)
    setSelectedPayment(null)
    setSelectedOrder(null)
  }

  return (
    <div className="space-y-4">
      {/* Confirmation bar */}
      {selPayment && selOrder && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-emerald-800">
            <span className="font-semibold">Confirmar match:</span>{' '}
            {ARS.format(selPayment.payment.monto)} ({selPayment.payment.nombrePagador || selPayment.payment.emailPagador})
            {' → '}
            Pedido #{selOrder.orderNumber} ({selOrder.customerName})
          </div>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {loading ? 'Procesando...' : 'Confirmar match'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: Unmatched Payments */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
            <h3 className="font-semibold text-slate-700">
              Pagos sin match <span className="text-slate-400 font-normal">({unmatchedPayments.length})</span>
            </h3>
          </div>
          {unmatchedPayments.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No hay pagos sin match</div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {unmatchedPayments.map(u => {
                const id = u.mpPaymentId || ''
                const isSelected = selectedPayment === id
                return (
                  <li
                    key={id}
                    onClick={() => setSelectedPayment(isSelected ? null : id)}
                    className={`cursor-pointer px-5 py-3 transition ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{ARS.format(u.payment.monto)}</p>
                        <p className="text-sm text-slate-600 truncate">{u.payment.nombrePagador || <span className="italic text-slate-400">Sin nombre</span>}</p>
                        <p className="text-xs text-slate-400 truncate">{u.payment.emailPagador}</p>
                        <p className="text-xs text-slate-400">{fmtDate(u.payment.fechaPago)}</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); onDismissPayment(id) }}
                        disabled={loading}
                        className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Right: Orders */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
            <h3 className="font-semibold text-slate-700">
              Pedidos pendientes <span className="text-slate-400 font-normal">({orders.length})</span>
            </h3>
          </div>
          {orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No hay pedidos pendientes</div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {orders.map(o => {
                const isSelected = selectedOrder === o.orderId
                const isSimilar = isAmountSimilar(o)
                return (
                  <li
                    key={o.orderId}
                    onClick={() => setSelectedOrder(isSelected ? null : o.orderId)}
                    className={`cursor-pointer px-5 py-3 transition ${
                      isSelected
                        ? 'bg-blue-50 border-l-4 border-blue-500'
                        : isSimilar
                        ? 'bg-emerald-50 border-l-4 border-emerald-300'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{ARS.format(o.total)}</p>
                        <p className="text-sm text-slate-600 truncate">{o.customerName}</p>
                        <p className="text-xs text-blue-600 font-semibold">#{o.orderNumber}</p>
                        <p className="text-xs text-slate-400">{o.storeName} · {fmtDate(o.createdAt)}</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); onMarkOrderPaid(o.storeId, o.orderId) }}
                        disabled={loading}
                        className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition disabled:opacity-50"
                      >
                        Pagado
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
