// Genera los íconos de la PWA desde public/logo.png.
//   node scripts/generar-iconos-pwa.mjs
// Requiere sharp (viene con Next). Salida en public/icons/.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'public', 'logo.png')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = { r: 6, g: 11, b: 20, alpha: 1 } // #060b14 (fondo del tema)

// Ícono "any": logo cubriendo todo el cuadrado, sobre el fondo del tema.
async function iconoLleno(size, nombre) {
  await sharp(src)
    .resize(size, size, { fit: 'cover' })
    .flatten({ background: BG })
    .png()
    .toFile(join(outDir, nombre))
  console.log('✓', nombre, `(${size}x${size})`)
}

// Ícono "maskable": logo al ~66% centrado, con padding (safe-zone del mask).
async function iconoMaskable(size, nombre) {
  const inner = Math.round(size * 0.66)
  const logo = await sharp(src).resize(inner, inner, { fit: 'contain', background: BG }).flatten({ background: BG }).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(join(outDir, nombre))
  console.log('✓', nombre, `(${size}x${size}, maskable)`)
}

await iconoLleno(192, 'icon-192.png')
await iconoLleno(512, 'icon-512.png')
await iconoLleno(180, 'apple-touch-icon.png')
await iconoMaskable(512, 'icon-maskable-512.png')
console.log('Listo → public/icons/')
