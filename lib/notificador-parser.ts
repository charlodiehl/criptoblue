// Parser del mensaje de notificación de pago que manda el sistema de
// "Notificador" — el mismo texto que ya envían a su grupo de Telegram,
// reenviado tal cual por su webhook. Formato (emojis como separadores
// visuales, no forman parte del parseo):
//
//   💰 NUEVA TRANSFERENCIA 📲
//   📅 Fecha: 1/7/2026, 06:05:02
//   👤 Titular: Dalma Carrizo
//   🏦 CBU/CVU: 0000003100002305531362
//   💵 Monto: $89.100,00
//   📋 Tipo: Transferencia

export interface NotificadorPago {
  fechaISO: string
  titular: string
  monto: number
  cbuCvu: string
  tipo: string
}

// Fecha: "1/7/2026, 06:05:02" (d/m/aaaa, ART) → ISO con offset -03:00
function extraerFecha(text: string): string | null {
  const m = text.match(/Fecha:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, min, ss] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh}:${min}:${ss || '00'}-03:00`
}

// Monto: "$89.100,00" — formato argentino (punto de miles, coma decimal)
function extraerMonto(text: string): number | null {
  const m = text.match(/Monto:\s*\$?\s*([\d.]+,\d{2})/)
  if (!m) return null
  const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(num) && num > 0 ? num : null
}

function extraerTitular(text: string): string {
  const m = text.match(/Titular:\s*(.+)/)
  return m ? m[1].trim() : ''
}

function extraerCbuCvu(text: string): string {
  const m = text.match(/CBU\/CVU:\s*(\d+)/)
  return m ? m[1].trim() : ''
}

function extraerTipo(text: string): string {
  const m = text.match(/Tipo:\s*(.+)/)
  return m ? m[1].trim() : ''
}

// Parsea el mensaje completo. Devuelve null si no matchea el formato esperado
// (fecha o monto ausentes/ilegibles). El filtro de "solo Transferencia" se
// aplica en el endpoint, no acá, para poder responder con un motivo específico.
export function parsearMensajeNotificador(text: string): NotificadorPago | null {
  if (!text) return null
  const fechaISO = extraerFecha(text)
  const monto = extraerMonto(text)
  if (!fechaISO || !monto) return null
  return {
    fechaISO,
    titular: extraerTitular(text),
    monto,
    cbuCvu: extraerCbuCvu(text),
    tipo: extraerTipo(text),
  }
}
