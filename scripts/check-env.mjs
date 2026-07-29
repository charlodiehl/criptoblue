// Cruza las variables de entorno que USA el código contra las que hay cargadas.
//
// Sirve para el caso que más duele: agregar un webhook nuevo, deployar, y recién
// enterarse de que falta su secreto cuando el proveedor manda el primer pago y el
// endpoint contesta 500.
//
//   node scripts/check-env.mjs                 → contra .env.local
//   node scripts/check-env.mjs --vercel        → contra Vercel (produccion)
//
// Para --vercel hace falta VERCEL_TOKEN en .env.local y el proyecto linkeado
// (.vercel/project.json).
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const RAIZ = process.cwd()
const IGNORAR = new Set(['node_modules', '.next', '.git', '.vercel'])

// Variables que inyecta la plataforma o el runtime: no se cargan a mano.
const DE_LA_PLATAFORMA = /^(NODE_ENV|VERCEL|VERCEL_.*|npm_.*|CI)$/

function archivos(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (IGNORAR.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, out)
    else if (/\.(ts|tsx|mjs)$/.test(n)) out.push(p)
  }
  return out
}

// process.env.FOO  y  process.env['FOO']
// Se separan las OBLIGATORIAS de las que tienen valor por defecto: si el código dice
// `process.env.FOO || 'algo'`, que falte no rompe nada, y marcarla como faltante hace
// que el chequeo grite en falso y se termine ignorando.
const usadas = new Map()      // nombre → [archivos]   (obligatorias)
const conFallback = new Map() // nombre → [archivos]
for (const p of archivos(RAIZ)) {
  const txt = readFileSync(p, 'utf8')
  const rel = p.slice(RAIZ.length + 1).replace(/\\/g, '/')
  if (rel.startsWith('scripts/')) continue      // los scripts leen .env.local, no Vercel
  for (const m of txt.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
    const nombre = m[1] || m[2]
    if (DE_LA_PLATAFORMA.test(nombre)) continue
    // ¿Lo que sigue a la lectura es un `||` o un `??` con un valor?
    const resto = txt.slice(m.index + m[0].length, m.index + m[0].length + 40)
    const destino = /^\s*(\|\||\?\?)\s*\S/.test(resto) ? conFallback : usadas
    if (!destino.has(nombre)) destino.set(nombre, [])
    if (!destino.get(nombre).includes(rel)) destino.get(nombre).push(rel)
  }
}
// Si en algún archivo se lee SIN fallback, manda esa: ahí sí es obligatoria.
for (const n of usadas.keys()) conFallback.delete(n)

let cargadas, dondeTxt
if (process.argv.includes('--vercel')) {
  const env = {}
  for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = l.indexOf('=')
    if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  const salida = execSync('npx vercel env ls production', {
    encoding: 'utf8',
    env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN },
  })
  cargadas = new Set(salida.split('\n')
    .map(l => (l.match(/^\s+([A-Z0-9_]+)\s+/) || [])[1])
    .filter(Boolean))
  dondeTxt = 'Vercel (Production)'
} else {
  cargadas = new Set(readFileSync('.env.local', 'utf8').split('\n')
    .map(l => (l.match(/^([A-Z0-9_]+)=/) || [])[1])
    .filter(Boolean))
  dondeTxt = '.env.local'
}

const faltan = [...usadas.keys()].filter(v => !cargadas.has(v)).sort()
const opcionalesSinCargar = [...conFallback.keys()].filter(v => !cargadas.has(v)).sort()
const sobran = [...cargadas]
  .filter(v => !usadas.has(v) && !conFallback.has(v) && !DE_LA_PLATAFORMA.test(v)).sort()

console.log(`Obligatorias: ${usadas.size} · con valor por defecto: ${conFallback.size} · cargadas en ${dondeTxt}: ${cargadas.size}`)
console.log('')

if (faltan.length) {
  console.log(`❌ FALTAN ${faltan.length} — el código las lee SIN valor por defecto:`)
  for (const v of faltan) console.log(`   ${v}\n      ← ${usadas.get(v).join(', ')}`)
} else {
  console.log('✅ No falta ninguna obligatoria.')
}

if (opcionalesSinCargar.length) {
  console.log('')
  console.log(`ℹ️  ${opcionalesSinCargar.length} sin cargar pero CON valor por defecto (no rompen):`)
  for (const v of opcionalesSinCargar) console.log(`   ${v}  ← ${conFallback.get(v).join(', ')}`)
}

if (sobran.length) {
  console.log('')
  console.log(`ℹ️  ${sobran.length} cargada(s) que el código ya no usa (no rompen nada, se pueden limpiar):`)
  console.log('   ' + sobran.join(', '))
}

process.exit(faltan.length ? 1 : 0)
