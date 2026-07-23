// Chequea que ninguna ruta se olvide de APLICAR la unidad de negocio.
//
// Por qué existe: en el runtime de Next, el setUnidad() que hace una función
// anidada NO le llega a quien la llamó (ver lib/unidad.ts). Por eso cada handler
// tiene que aplicarla en su propio frame, después del guard:
//
//     const auth = await requireUser()
//     if ('error' in auth) return auth.error
//     setUnidad(auth.user.unidad)
//
// Olvidarse esa línea no rompe el build: rompe en runtime, con "Unidad de negocio
// no establecida". Este script lo caza antes.
//
//   node scripts/check-unidades.mjs

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function rutas(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...rutas(p))
    else if (e === 'route.ts') out.push(p.replace(/\\/g, '/'))
  }
  return out
}

const fallas = []
for (const p of rutas('app')) {
  const src = readFileSync(p, 'utf8')
  const tieneGuard = /await requireUser\(|await requireUnidad\(/.test(src)
  const aplica = /setUnidad\(/.test(src)
  const usaRun = /runEnUnidad\(|porCadaUnidad\(/.test(src)
  if (tieneGuard && !aplica && !usaRun) fallas.push(`${p} — tiene guard de sesión pero nunca llama a setUnidad()`)
}

// Las páginas (server components) que leen la sesión también tienen que aplicarla.
for (const p of ['app/tienda/page.tsx', 'app/billetera/page.tsx', 'app/finanzas/page.tsx', 'app/notificaciones/page.tsx']) {
  const src = readFileSync(p, 'utf8')
  if (/getSessionUser\(/.test(src) && !/setUnidad\(/.test(src)) {
    fallas.push(`${p} — lee la sesión pero nunca llama a setUnidad()`)
  }
}

if (fallas.length) {
  console.error('❌ Rutas sin aplicar la unidad de negocio:\n')
  for (const f of fallas) console.error('   ' + f)
  process.exit(1)
}
console.log('✅ Todas las rutas aplican la unidad de negocio.')
