// Verificación del parser de comprobantes. Ejecutar con: node scripts/verificar-ocr.ts
// (Node 24 ejecuta TypeScript directamente vía type-stripping)
import { parseComprobante } from '../lib/ocr-comprobante.ts'

interface Caso {
  nombre: string
  texto: string
  espera: { monto: number | null; nombre?: string; fechaContiene?: string }
}

const casos: Caso[] = [
  {
    // Caso real del usuario — comprobante MP completo. Queremos el PAGADOR (De),
    // no el destinatario (Para = la tienda). "Transferencia" no debe colarse de nombre.
    nombre: 'MercadoPago - comprobante completo (De/Para)',
    texto: `mercado pago
Comprobante de transferencia
Domingo, 14 de junio de 2026 a las 09:35 hs
$ 52.920
Motivo: Varios
De
Maria Soledad Nazarre
CUIT/CUIL: 27-24256770-1
Mercado Pago
CVU: 0000003100068240675664
Para
Mileidy Andreina Infante Acacio
CUIT/CUIL: 20-19099725-2
Mercado Pago
CVU: 0000003100034364181109
Número de operación de Mercado Pago
164070234934`,
    espera: { monto: 52920, nombre: 'Maria Soledad Nazarre', fechaContiene: '2026-06-14T09:35' },
  },
  {
    // Mismo comprobante pero el OCR NO leyó el símbolo "$" (caso real frecuente)
    nombre: 'MercadoPago - sin símbolo $ (OCR falla)',
    texto: `mercado pago
Comprobante de transferencia
Domingo, 14 de junio de 2026 a las 09:35 hs
52.920
Motivo: Varios
De
Maria Soledad Nazarre
CUIT/CUIL: 27-24256770-1
CVU: 0000003100068240675664
Para
Mileidy Andreina Infante Acacio
Número de operación de Mercado Pago
164070234934`,
    espera: { monto: 52920, nombre: 'Maria Soledad Nazarre', fechaContiene: '2026-06-14T09:35' },
  },
  {
    nombre: 'Banco - "De:" en la misma línea',
    texto: `Comprobante de transferencia
Importe: $ 128.558,00
De: Gonzalo Javier Gianelli
CUIT: 20-12345678-9
Fecha: 16/05/2026 09:06`,
    espera: { monto: 128558, nombre: 'Gonzalo Javier Gianelli', fechaContiene: '2026-05-16T09:06' },
  },
  {
    nombre: 'Monto con $ pegado y nombre bajo "De"',
    texto: `De
PEREZ SILVANA
$54.224
03-06-2026 10:22`,
    espera: { monto: 54224, nombre: 'Perez Silvana', fechaContiene: '2026-06-03T10:22' },
  },
  {
    nombre: 'Millones con separadores de miles sin $',
    texto: `Transferencia recibida
3.596.753,09
Origen Maria Laura Zaccra
20 de mayo de 2026 11:12`,
    espera: { monto: 3596753.09, nombre: 'Maria Laura Zaccra', fechaContiene: '2026-05-20T11:12' },
  },
  {
    // Texto OCR REAL (caso del usuario): el bullet "•" se leyó como "?" y "*",
    // y el OCR se SALTÓ la línea del monto. Verifica que igual saca nombre y fecha.
    nombre: 'OCR real MP (bullet "?", monto ausente)',
    texto: `É- mercado
pago
Comprobante de transferencia
Domingo, 14 de junio de 2026 a las 09:35 hs
Motivo: Varios
? De
Maria Soledad Nazarre
CUIT/CUIL: 27-24256770-4
Mercado Pago
'CVU: 0000003100068240675664
* Para
Mileidy Andreina Infante Acacio
CUIT/CUIL: 20-19099725-2
Mercado Pago
VU: 0000003100034364181109
Número de operación de Mercado Pago
164070234934`,
    espera: { monto: null, nombre: 'Maria Soledad Nazarre', fechaContiene: '2026-06-14T09:35' },
  },
]

let ok = 0, fail = 0
for (const c of casos) {
  const r = parseComprobante(c.texto)
  const errores: string[] = []
  if (r.monto !== c.espera.monto) errores.push(`monto: esperaba ${c.espera.monto}, obtuvo ${r.monto}`)
  if (c.espera.nombre !== undefined && r.nombrePagador !== c.espera.nombre) errores.push(`nombre: esperaba "${c.espera.nombre}", obtuvo "${r.nombrePagador}"`)
  if (c.espera.fechaContiene && !(r.fechaISO ?? '').startsWith(c.espera.fechaContiene)) errores.push(`fecha: esperaba que empiece con "${c.espera.fechaContiene}", obtuvo "${r.fechaISO}"`)
  if (errores.length) {
    fail++
    console.log(`✗ ${c.nombre}`)
    errores.forEach(e => console.log(`    ${e}`))
    console.log(`    debug:`, JSON.stringify(r._debug))
  } else {
    ok++
    console.log(`✓ ${c.nombre}`)
  }
}
console.log(`\n${ok}/${casos.length} casos OK${fail ? `, ${fail} fallaron` : ''}`)
