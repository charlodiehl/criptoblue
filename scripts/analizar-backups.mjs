// Analiza los backups locales para ver la composición de los pagos viejos.
import { readFileSync, readdirSync } from 'node:fs'

function ultimoBackup(prefijo) {
  const files = readdirSync('.').filter(f => f.startsWith(prefijo) && f.endsWith('.json')).sort()
  return files[files.length - 1]
}

const fReg = ultimoBackup('backup-registro-')
const fCola = ultimoBackup('backup-cola-')
console.log('Archivos:')
console.log('  registro:', fReg)
console.log('  cola:    ', fCola)

const reg = JSON.parse(readFileSync(fReg, 'utf8'))
const cola = JSON.parse(readFileSync(fCola, 'utf8'))
const filas = reg.registro_log ?? []

const porAction = {}, porSource = {}
const idsMP = new Set()
let conPayment = 0
for (const r of filas) {
  porAction[r.action] = (porAction[r.action] || 0) + 1
  if (r.payment) {
    conPayment++
    const src = r.payment.source || '(sin source)'
    porSource[src] = (porSource[src] || 0) + 1
    if (src === 'mercadopago' && r.payment.mpPaymentId) idsMP.add(r.payment.mpPaymentId)
  }
}

console.log('\n=== registro_log (backup) ===')
console.log('total filas:', filas.length, '| con payment:', conPayment)
console.log('por action:', JSON.stringify(porAction))
console.log('por payment.source:', JSON.stringify(porSource))
console.log('pagos MP únicos (por mpPaymentId):', idsMP.size)

const um = cola.state?.unmatchedPayments ?? []
const rm = cola.state?.recentMatches ?? []
let umMP = 0
const idsTodos = new Set(idsMP)
for (const u of um) {
  if (u.payment?.source === 'mercadopago') { umMP++; if (u.payment.mpPaymentId) idsTodos.add(u.payment.mpPaymentId) }
}
for (const m of rm) {
  if (m.payment?.source === 'mercadopago' && m.payment.mpPaymentId) idsTodos.add(m.payment.mpPaymentId)
}

console.log('\n=== cola (backup) ===')
console.log('unmatchedPayments:', um.length, '| de MP:', umMP)
console.log('recentMatches:', rm.length)

console.log('\n=== TOTAL pagos MP únicos (registro + cola + recentMatches) ===')
console.log(idsTodos.size, 'pagos únicos de MercadoPago')

// Tamaño aproximado si lo guardáramos como un solo blob
const muestraMP = filas.filter(r => r.payment?.source === 'mercadopago').slice(0, 3).map(r => ({
  mpPaymentId: r.payment.mpPaymentId, monto: r.payment.monto, nombre: r.payment.nombrePagador,
  fecha: r.payment.fechaPago, cuit: r.payment.cuitPagador,
}))
console.log('\nEjemplos de pago MP:', JSON.stringify(muestraMP, null, 2))
