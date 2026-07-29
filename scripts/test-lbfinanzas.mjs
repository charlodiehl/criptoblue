// Prueba del parser de los emails de LB Finanzas contra los dos avisos REALES.
// No toca la base ni la red: solo compila el módulo y le pasa los cuerpos.
//   node scripts/test-lbfinanzas.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

// Se aísla el parser en un .ts temporal: el resto del archivo importa módulos del
// server (Supabase, etc.) que no se pueden cargar desde un script suelto. Node le
// saca los tipos solo (--experimental-strip-types), sin necesidad de bundler.
const src = readFileSync(new URL('../app/api/lbfinanzas/webhook/route.ts', import.meta.url), 'utf8')
const soloParser = src
  .split('// Llega SIN sesión')[0]
  .split('\n').filter(l => !l.startsWith('import ')).join('\n')

const tmp = join(tmpdir(), `lbf-parser-${process.pid}.ts`)
writeFileSync(tmp, soloParser, 'utf8')
let mod
try {
  mod = await import(pathToFileURL(tmp).href)
} finally {
  try { unlinkSync(tmp) } catch { /* da igual si no se pudo borrar */ }
}
const { parsearCuerpoLbf, parsearMontoLbf, parsearFechaLbf } = mod

// ── Aviso REAL de depósito recibido (el que sí hay que cargar) ───────────────
const RECIBIDO = ` Nuevo depósito recibido

[image: LB Finanzas]

[image: Success]
Recibiste
33.215,33 ARS
Detalle del depósito
Origen Maria Luisa Bellia
CBU/CVU 0140015103401550915865
Fecha 29.07.26 12:15
Red de pago Transferencia Bancaria
Comisión 116,66 ARS
Abrir App <https://app.lbfinanzas.com>
`

// ── Aviso REAL de transferencia SALIENTE (el que NO hay que cargar) ──────────
const ENVIADO = ` Transferencia realizada con éxito

[image: LB Finanzas]

[image: Success]
Enviaste
475.500,00 ARS
Detalle de la transferencia
Destinatario Reyes Palacios Matias Emiliano
CBU/CVU 0720099188000002229036
Fecha 29.07.26 12:13
Red de pago Transferencia Bancaria
Comisión 0,00 ARS
`

let fallos = 0
const chequear = (etiqueta, real, esperado) => {
  const ok = String(real) === String(esperado)
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${etiqueta.padEnd(34)} ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`)
}

console.log('── Depósito recibido ──')
const r = parsearCuerpoLbf(RECIBIDO)
chequear('esEntrante', r.esEntrante, true)
chequear('acreditado ("Recibiste", NETO)', r.montoAcreditado, 33215.33)
chequear('comisión de LB', r.comisionArs, 116.66)
chequear('monto BRUTO = acreditado + comisión', r.monto, 33331.99)
chequear('moneda', r.moneda, 'ARS')
chequear('origen', r.origen, 'Maria Luisa Bellia')
chequear('cbuCvu', r.cbuCvu, '0140015103401550915865')
chequear('fecha (ISO, era 12:15 ART)', r.fecha?.toISOString(), '2026-07-29T15:15:00.000Z')
chequear('redDePago', r.redDePago, 'Transferencia Bancaria')

// ── Regresión: los dos pagos reales que se cargaron 0,35% cortos ────────────
// El bot de Notificador informó 59.415 y 299.999,01 para estos mismos depósitos.
// Cargar el "Recibiste" a secas dejaba el pago corto y no emparejaba nunca.
console.log('')
console.log('── Bruto reconstruido = lo que informó el Notificador ──')
const armar = (recibiste, comision) => ` Nuevo depósito recibido
Recibiste
${recibiste} ARS
Detalle del depósito
Origen Fulano De Tal
CBU/CVU 0000003100009047480882
Fecha 29.07.26 13:51
Red de pago Transferencia Bancaria
Comisión ${comision} ARS
`
chequear('Evangelina: 59.207,05 + 207,95', parsearCuerpoLbf(armar('59.207,05', '207,95')).monto, 59415)
chequear('Sergio: 298.949,01 + 1.050,00', parsearCuerpoLbf(armar('298.949,01', '1.050,00')).monto, 299999.01)
chequear('depósito sin comisión (0,00)', parsearCuerpoLbf(armar('10.000,00', '0,00')).monto, 10000)

// Sin el campo "Comisión" el bruto no es reconstruible → NaN, y el handler rechaza.
const sinComision = parsearCuerpoLbf(` Nuevo depósito recibido
Recibiste
50.000,00 ARS
Detalle del depósito
Origen Fulano De Tal
Fecha 29.07.26 13:51
`)
chequear('sin campo Comisión → comisión NaN', Number.isNaN(sinComision.comisionArs), true)
chequear('sin campo Comisión → monto NaN (no se carga)', Number.isNaN(sinComision.monto), true)

console.log('')
console.log('── Transferencia SALIENTE: no se debe cargar ──')
const e = parsearCuerpoLbf(ENVIADO)
chequear('esEntrante', e.esEntrante, false)

// ── El mismo aviso REENVIADO a comprobantespagosblue@ ────────────────────────
// Trae el encabezado del reenvío (con SU propia "Fecha:", que es la trampa) y las
// líneas citadas con ">".
const REENVIADO = `---------- Forwarded message ---------
De: LB Finanzas <no-reply@lbfinanzas.com>
Fecha: mié, 30 jul 2026 a las 9:02
Asunto: Nuevo depósito recibido
Para: <ivandriz@gmail.com>

> Recibiste
> 33.215,33 ARS
> Detalle del depósito
> Origen Maria Luisa Bellia
> CBU/CVU 0140015103401550915865
> Fecha 29.07.26 12:15
> Red de pago Transferencia Bancaria
> Comisión 116,66 ARS
`

console.log('')
console.log('── Reenviado: no se puede confundir con la fecha del reenvío ──')
const f = parsearCuerpoLbf(REENVIADO)
chequear('esEntrante', f.esEntrante, true)
chequear('acreditado', f.montoAcreditado, 33215.33)
chequear('monto BRUTO', f.monto, 33331.99)
chequear('origen', f.origen, 'Maria Luisa Bellia')
chequear('cbuCvu', f.cbuCvu, '0140015103401550915865')
chequear('fecha = la del DEPÓSITO, no la del reenvío', f.fecha?.toISOString(), '2026-07-29T15:15:00.000Z')

console.log('')
console.log('── Reenviado pero SALIENTE: tampoco se carga ──')
const fe = parsearCuerpoLbf(`---------- Forwarded message ---------
De: LB Finanzas <no-reply@lbfinanzas.com>
Asunto: Transferencia realizada

> Enviaste
> 475.500,00 ARS
> Detalle de la transferencia
> Destinatario Reyes Palacios Matias Emiliano
> Fecha 29.07.26 12:13
`)
chequear('esEntrante', fe.esEntrante, false)

console.log('')
console.log('── Formato de montos: confundirlo cambia la plata por mil ──')
chequear('33.215,33', parsearMontoLbf('33.215,33'), 33215.33)
chequear('475.500,00', parsearMontoLbf('475.500,00'), 475500)
chequear('1.000 (sin decimales)', parsearMontoLbf('1.000'), 1000)
chequear('59.415', parsearMontoLbf('59.415'), 59415)
chequear('116,66', parsearMontoLbf('116,66'), 116.66)

console.log('')
console.log('── Fechas (dd.mm.aa hh:mm en hora Argentina) ──')
chequear('29.07.26 12:15', parsearFechaLbf('29.07.26 12:15')?.toISOString(), '2026-07-29T15:15:00.000Z')
chequear('01.01.27 00:05', parsearFechaLbf('01.01.27 00:05')?.toISOString(), '2027-01-01T03:05:00.000Z')

console.log('')
console.log(fallos ? `❌ ${fallos} chequeo(s) fallaron` : '✅ Todo OK')
process.exit(fallos ? 1 : 0)
