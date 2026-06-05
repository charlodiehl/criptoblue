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
    nombre: 'MercadoPago - transferencia enviada',
    texto: `Mercado Pago
Transferencia enviada
$ 55.920,00
Para
Marina Ruel
CVU 0000003100012345678901
12 de mayo de 2026 22:39 hs`,
    espera: { monto: 55920, nombre: 'Marina Ruel', fechaContiene: '2026-05-12T22:39' },
  },
  {
    nombre: 'Banco - comprobante con labels',
    texto: `Comprobante de transferencia
Importe: $ 128.558,00
Destinatario: Gonzalo Javier Gianelli
CUIT: 20-12345678-9
Fecha: 16/05/2026 09:06`,
    espera: { monto: 128558, nombre: 'Gonzalo Javier Gianelli', fechaContiene: '2026-05-16T09:06' },
  },
  {
    nombre: 'Monto sin decimales y fecha con guiones',
    texto: `Transferiste
$54.224
A nombre de PEREZ SILVANA
03-06-2026 10:22`,
    espera: { monto: 54224, nombre: 'Perez Silvana', fechaContiene: '2026-06-03T10:22' },
  },
  {
    nombre: 'Monto con punto decimal estilo extranjero',
    texto: `Total pagado
$ 1234.50
Titular Juan Perez
01/01/2026`,
    espera: { monto: 1234.5, nombre: 'Juan Perez', fechaContiene: '2026-01-01' },
  },
  {
    nombre: 'Millones con separadores de miles',
    texto: `Monto $ 3.596.753,09
Beneficiario Maria Laura Zaccra
20 de mayo de 2026 11:12`,
    espera: { monto: 3596753.09, nombre: 'Maria Laura Zaccra', fechaContiene: '2026-05-20T11:12' },
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
