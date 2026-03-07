import { CONFIG } from './config'
import type { Payment, Order } from './types'

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

export interface AIMatchResult {
  confirmed: boolean
  confidence: number
  reasoning: string
}

export async function aiValidateMatch(
  payment: Payment,
  order: Order
): Promise<AIMatchResult | null> {
  const { apiKey, model } = CONFIG.openrouter
  if (!apiKey) return null

  const diffMonto = Math.abs(payment.monto - order.total)
  const payTime = payment.fechaPago ? new Date(payment.fechaPago) : null
  const orderTime = order.createdAt ? new Date(order.createdAt) : null
  const diffMinutos = payTime && orderTime ? Math.round((payTime.getTime() - orderTime.getTime()) / 60000) : null

  const prompt = `Sos un sistema de conciliación de pagos de Argentina. Analizá si este pago de MercadoPago corresponde a este pedido de e-commerce.

IMPORTANTE: Los pagos son transferencias bancarias/CVU. El nombre del pagador generalmente NO está disponible en la API de MP.
La identidad se determina por email y/o DNI/CUIL.

PAGO (MercadoPago):
- Monto pagado: ${ARS.format(payment.monto)}
- Email pagador: ${payment.emailPagador || 'No disponible'}
- CUIL pagador: ${payment.cuitPagador || 'No disponible'}
- Nombre pagador: ${payment.nombrePagador || 'No disponible (normal en transferencias)'}
- Fecha del pago: ${payment.fechaPago || 'No disponible'}
- Referencia: ${payment.referencia || 'Sin referencia'}

PEDIDO (TiendaNube - ${order.storeName}):
- Número de pedido: #${order.orderNumber}
- Total del pedido: ${ARS.format(order.total)}
- Nombre cliente: ${order.customerName || 'No disponible'}
- Email cliente: ${order.customerEmail || 'No disponible'}
- DNI cliente: ${order.customerCuit || 'No disponible'}
- Fecha creación: ${order.createdAt || 'No disponible'}

ANÁLISIS PREVIO (algoritmo):
- Diferencia de monto: ${ARS.format(diffMonto)} ${diffMonto <= 10 ? '✅ exacto' : diffMonto <= 100 ? '✅ muy cercano' : diffMonto <= 1000 ? '⚠️ tolerable' : '❌ grande'}
- Tiempo entre pedido y pago: ${diffMinutos !== null ? diffMinutos + ' minutos' : 'no calculable'} ${diffMinutos !== null && diffMinutos >= 0 && diffMinutos <= 60 ? '✅' : diffMinutos !== null && diffMinutos > 1440 ? '⚠️ más de 1 día' : ''}
- Email: ${payment.emailPagador === order.customerEmail ? '✅ coincide exactamente' : 'no coincide o no disponible'}
- DNI/CUIL: ${payment.cuitPagador && order.customerCuit && (payment.cuitPagador.includes(order.customerCuit) || order.customerCuit.includes(payment.cuitPagador.slice(2,10))) ? '✅ DNI coincide' : 'no coincide o no disponible'}

Reglas:
1. Si el email coincide exactamente → muy alta probabilidad de match
2. Si el DNI del cliente está contenido en el CUIL del pagador → muy alta probabilidad
3. Diferencia de monto menor a $1000 ARS es aceptable (puede haber descuentos)
4. El pago debe ser posterior a la creación del pedido (tolerancia de 1 minuto)
5. Un tercero puede pagar por otra persona (el nombre puede no coincidir)

Respondé ÚNICAMENTE con JSON en este formato exacto, sin texto extra:
{"confirmed": true/false, "confidence": 0-100, "reasoning": "explicación breve en español (máx 120 chars)"}`

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://criptoblue.vercel.app',
        'X-Title': 'CriptoBlue',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    return JSON.parse(content) as AIMatchResult
  } catch {
    return null
  }
}
