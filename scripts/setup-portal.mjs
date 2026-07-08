// Setup post-migración del portal: crea el bucket privado de comprobantes.
// Correr UNA vez (idempotente) después de ejecutar migrations/2026-07-portal-finanzas.sql:
//   node scripts/setup-portal.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] ??= v.join('=').trim()
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// 1) Bucket privado para comprobantes de transferencias
const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
if (bErr) throw new Error(bErr.message)

if (buckets.some(b => b.name === 'comprobantes')) {
  console.log('Bucket "comprobantes" ya existe ✓')
} else {
  const { error } = await supabase.storage.createBucket('comprobantes', {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024, // 10 MB por archivo
  })
  if (error) throw new Error(error.message)
  console.log('Bucket "comprobantes" creado (privado, 10MB máx) ✓')
}

// 2) Verificar que la migración SQL ya corrió (las 3 tablas responden)
for (const tabla of ['app_users', 'transfer_requests', 'balance_movements']) {
  const { error } = await supabase.from(tabla).select('*', { count: 'exact', head: true })
  console.log(error ? `✗ Tabla ${tabla}: ${error.message} — ¿corriste la migración SQL?` : `Tabla ${tabla} ✓`)
}
