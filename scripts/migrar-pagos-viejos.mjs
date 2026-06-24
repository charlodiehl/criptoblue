// Sube a Supabase los pagos viejos de MercadoPago que quedaron SIN emparejar
// (los unmatchedPayments que estaban en la cola al momento del borrón).
// Quedan en la key criptoblue:pagos-viejos-mp para consulta de solo lectura.
//
// Uso:
//   node --env-file=.env.vercel-prod scripts/migrar-pagos-viejos.mjs           (dry-run)
//   node --env-file=.env.vercel-prod scripts/migrar-pagos-viejos.mjs --confirmar

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'node:fs'

const CONFIRMAR = process.argv.includes('--confirmar')
const KEY = 'criptoblue:pagos-viejos-mp'

function ultimoBackup(prefijo) {
  const files = readdirSync('.').filter(f => f.startsWith(prefijo) && f.endsWith('.json')).sort()
  return files[files.length - 1]
}

const fCola = ultimoBackup('backup-cola-')
if (!fCola) { console.error('❌ No se encontró backup-cola-*.json'); process.exit(1) }
console.log('Backup de la cola:', fCola)

const cola = JSON.parse(readFileSync(fCola, 'utf8'))
const unmatched = cola.state?.unmatchedPayments ?? []

// Extraer los pagos (solo los de MercadoPago, por las dudas) y ordenarlos por fecha desc.
const pagos = unmatched
  .map(u => u.payment)
  .filter(p => p && p.source === 'mercadopago')
  .sort((a, b) => new Date(b.fechaPago).getTime() - new Date(a.fechaPago).getTime())

console.log(`Pagos sin emparejar (MercadoPago): ${pagos.length}`)
console.log('Ejemplos:')
for (const p of pagos.slice(0, 3)) {
  console.log(`  - $${p.monto} | ${p.nombrePagador || 's/nombre'} | ${p.fechaPago} | id ${p.mpPaymentId}`)
}

const valor = {
  generatedAt: new Date().toISOString(),
  total: pagos.length,
  payments: pagos,
}

if (!CONFIRMAR) {
  console.log('\n(DRY-RUN) No se subió nada. Para ejecutar agregá --confirmar')
  process.exit(0)
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const { error } = await supabase.from('kv_store').upsert({ key: KEY, value: valor, updated_at: new Date().toISOString() })
if (error) { console.error('❌ Error:', error.message); process.exit(1) }

console.log(`\n✅ Subidos ${pagos.length} pagos a la key ${KEY}`)
