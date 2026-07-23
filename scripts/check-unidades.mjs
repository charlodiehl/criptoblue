// Auditor de unidad de negocio — POR HANDLER y CON ORDEN.
//
// La regla que verifica: dentro de cada handler (GET/POST/… de cada route.ts, y las
// páginas server-side), NINGUNA operación de datos puede ejecutarse antes de que la
// unidad quede aplicada (setUnidad / runEnUnidad / porCadaUnidad).
//
// Por qué es por handler y con orden — las dos veces que se rompió producción:
//   1ª: setUnidad() dentro de una función anidada no le llega al handler (Next).
//   2ª: manual-match tomaba acquireLock() ANTES del guard → el lock lee kv_store
//       con key por unidad → "Unidad de negocio no establecida". El chequeo viejo
//       solo miraba que el archivo tuviera setUnidad EN ALGÚN LADO, y pasaba.
//
// También verifica que nadie se fabrique un cliente Supabase propio con la service
// key (se saltea el proxy que acota por unidad — ya pasó con balance/reembolsos).
//
//   node scripts/check-unidades.mjs

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// ── Qué cuenta como "operación de datos" ─────────────────────────────────────
// Módulos cuyo estado vive en kv_store o en tablas por unidad: TODA función
// importada de ellos toca datos acotados.
const MODULOS_DATOS = [
  '@/lib/storage', './storage', '../storage',
  '@/lib/registro', '@/lib/registro-api', '@/lib/balance', '@/lib/billeteras',
  '@/lib/reembolsos', '@/lib/transferencias', '@/lib/billetera-salidas',
  '@/lib/metricas', '@/lib/conceptos', '@/lib/comisiones', '@/lib/equipo',
  '@/lib/api-keys', '@/lib/multi-acceso', '@/lib/saldo-personalizado',
  '@/lib/editar-movimiento', '@/lib/shopify-apps', '@/lib/push',
  '@/lib/cycle', '@/lib/auto-match-runner', '@/lib/buscar-orden',
]
// Funciones que APLICAN la unidad.
const APLICADORES = /\b(setUnidad|runEnUnidad|porCadaUnidad)\s*\(/

// Funciones EXENTAS del orden: diseñadas para correr sin unidad establecida.
//   auditarRequest → audita también intentos con API key inválida (cliente crudo +
//                    getUnidadOpcional, tolerante por diseño — ver lib/api-keys.ts).
//   validarApiKey  → es la que RESUELVE la unidad (busca la key en todas).
const EXENTAS = new Set(['auditarRequest', 'validarApiKey'])

function archivos(dir, nombre) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...archivos(p, nombre))
    else if (nombre.test(e)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

// Identificadores de datos importados por un archivo (según su bloque de imports).
function identificadoresDeDatos(src) {
  const ids = new Set()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (!MODULOS_DATOS.some(mod => m[2] === mod)) continue
    for (const raw of m[1].split(',')) {
      const id = raw.replace(/\btype\b/, '').split(' as ').pop().trim()
      if (id) ids.add(id)
    }
  }
  return ids
}

// Cuerpos de los handlers exportados: [nombre, texto]. Corta en la próxima
// función top-level (suficiente para este codebase: handlers bien delimitados).
function handlers(src, esPagina) {
  const out = []
  const re = esPagina
    ? /export default async function (\w+)/g
    : /export async function (GET|POST|PATCH|PUT|DELETE)\b/g
  const marcas = [...src.matchAll(re)].map(m => ({ nombre: m[1], desde: m.index }))
  const topLevel = [...src.matchAll(/^(?:export )?(?:async )?function \w+|^const \w+ = (?:async )?\(/gm)].map(m => m.index)
  for (const { nombre, desde } of marcas) {
    const fin = Math.min(...topLevel.filter(i => i > desde), src.length)
    out.push({ nombre, texto: src.slice(desde, fin), desde })
  }
  return out
}

// Helpers locales del archivo que tocan datos (el handler puede llamarlos).
// Un helper que él mismo APLICA la unidad (envuelve su trabajo en runEnUnidad /
// porCadaUnidad, como el run() de los crons) no cuenta como peligroso.
function helpersConDatos(src, ids) {
  const out = new Set()
  for (const m of src.matchAll(/(?:^|\n)(?:async )?function (\w+)/g)) {
    const desde = m.index
    const fin = Math.min(...[...src.matchAll(/(?:^|\n)(?:export )?(?:async )?function \w+/g)]
      .map(x => x.index).filter(i => i > desde), src.length)
    const cuerpo = src.slice(desde, fin)
    if (/\b(runEnUnidad|porCadaUnidad)\s*\(/.test(cuerpo)) continue
    for (const id of ids) {
      if (EXENTAS.has(id)) continue
      if (new RegExp(`\\b${id}\\s*\\(`).test(cuerpo)) { out.add(m[1]); break }
    }
  }
  return out
}

const fallas = []

function auditar(path, esPagina) {
  const src = readFileSync(path, 'utf8')
  const ids = identificadoresDeDatos(src)
  const helpers = helpersConDatos(src, ids)
  const peligrosos = [...ids, ...helpers]
  if (!peligrosos.length) return                       // no toca datos: no aplica

  for (const h of handlers(src, esPagina)) {
    // Handlers que corren por-unidad con runEnUnidad/porCadaUnidad envolviendo el
    // trabajo: el orden lo garantiza el wrapper, alcanza con que exista.
    const idxAplica = h.texto.search(APLICADORES)
    let primerDato = Infinity, quien = null
    for (const id of peligrosos) {
      if (EXENTAS.has(id)) continue
      const m = h.texto.match(new RegExp(`\\b${id}\\s*\\(`))
      if (m && m.index < primerDato) { primerDato = m.index; quien = id }
    }
    if (primerDato === Infinity) continue               // este handler no toca datos
    if (idxAplica === -1) {
      fallas.push(`${path} → ${h.nombre}(): toca datos (${quien}) y NUNCA aplica la unidad`)
    } else if (primerDato < idxAplica) {
      fallas.push(`${path} → ${h.nombre}(): llama a ${quien}() ANTES de aplicar la unidad`)
    }
  }
}

for (const p of archivos('app', /^route\.ts$/)) auditar(p, false)
for (const p of archivos('app', /^page\.tsx$/)) auditar(p, true)

// ── Clientes crudos fuera de los permitidos ──────────────────────────────────
const CLIENTES_PERMITIDOS = new Set([
  'lib/storage.ts',          // el proxeado (y su crudo, para lo trans-unidad)
  'lib/auth/server.ts',      // serviceClient(): resuelve en qué unidad está el usuario
  'lib/supabase-browser.ts', // cliente del navegador, con anon key
])
for (const p of archivos('lib', /\.ts$/)) {
  if (CLIENTES_PERMITIDOS.has(p)) continue
  if (/SUPABASE_SERVICE_KEY/.test(readFileSync(p, 'utf8'))) {
    fallas.push(`${p} — se fabrica su propio cliente con la service key: usá getClient() de lib/storage`)
  }
}

if (fallas.length) {
  console.error(`❌ ${fallas.length} problema(s) de unidad de negocio:\n`)
  for (const f of fallas) console.error('   ' + f)
  process.exit(1)
}
console.log('✅ Todos los handlers aplican la unidad ANTES de tocar datos.')
