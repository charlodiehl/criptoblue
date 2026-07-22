// Runner de migraciones SQL contra Postgres (Supabase) por conexión directa.
// Las migraciones DDL (ALTER TABLE, etc.) no se pueden correr por la service key /
// PostgREST — necesitan conexión directa. La cadena vive en .env.local como
// DATABASE_URL (local, gitignored — nunca en git ni en memoria).
//
// Uso (desde la raíz del proyecto):
//   node scripts/migrate.mjs migrations/<archivo>.sql
//
// Tras aplicar, avisa a PostgREST que recargue el schema (NOTIFY pgrst) para que la
// API vea las columnas nuevas de inmediato, sin esperar el refresh automático.

import pg from 'pg'
import { readFileSync } from 'fs'

// Carga .env.local (saca comillas envolventes de los valores si las hubiera).
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const i = l.indexOf('=')
  if (i <= 0) continue
  const k = l.slice(0, i).trim()
  let v = l.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (k && !(k in process.env)) process.env[k] = v
}

const url = process.env.DATABASE_URL
if (!url) { console.error('Falta DATABASE_URL en .env.local'); process.exit(1) }

const file = process.argv[2]
if (!file) { console.error('Uso: node scripts/migrate.mjs migrations/<archivo>.sql'); process.exit(1) }

const sql = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql)
  await client.query("NOTIFY pgrst, 'reload schema'")   // PostgREST ve las columnas nuevas ya
  console.log(`OK: aplicado ${file}`)
} finally {
  await client.end()
}
