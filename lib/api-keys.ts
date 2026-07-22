import { createHash, randomBytes } from 'crypto'
import { serviceClient } from '@/lib/auth/server'

// ─────────────────────────────────────────────────────────────────────────────
// Keys de la API pública de registro (tabla store_api_keys).
// La key en texto plano se muestra UNA sola vez al generarla; en la DB vive SOLO su
// hash SHA-256. El request la manda por `Authorization: Bearer <key>`.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = 'cb_live_'

export function hashKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex')
}

// Genera una key para una tienda. Devuelve el texto plano (mostrar una vez) + guarda el hash.
export async function generarApiKey(storeId: string, label?: string): Promise<{ key: string; id: number; prefix: string }> {
  const key = PREFIX + randomBytes(24).toString('hex')   // cb_live_ + 48 hex
  const key_prefix = key.slice(0, 12)                    // cb_live_xxxx (identifica en logs, no es secreto)
  const { data, error } = await serviceClient()
    .from('store_api_keys')
    .insert({ store_id: storeId, key_hash: hashKey(key), key_prefix, label: label ?? null })
    .select('id')
    .single<{ id: number }>()
  if (error) throw new Error(error.message)
  return { key, id: data.id, prefix: key_prefix }
}

export type ValidacionKey =
  | { ok: true; keyId: number; storeId: string }
  | { ok: false; reason: 'invalid' | 'revoked' }

// Valida una key por su hash. No compara texto plano: lookup por el hash indexado.
export async function validarApiKey(key: string): Promise<ValidacionKey> {
  if (!key) return { ok: false, reason: 'invalid' }
  const { data } = await serviceClient()
    .from('store_api_keys')
    .select('id, store_id, revoked_at')
    .eq('key_hash', hashKey(key))
    .maybeSingle<{ id: number; store_id: string; revoked_at: string | null }>()
  if (!data) return { ok: false, reason: 'invalid' }
  if (data.revoked_at) return { ok: false, reason: 'revoked' }
  return { ok: true, keyId: data.id, storeId: data.store_id }
}

export async function marcarUso(keyId: number): Promise<void> {
  await serviceClient().from('store_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyId)
}

export async function revocarApiKey(keyId: number): Promise<void> {
  await serviceClient().from('store_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', keyId)
}

// Rate limit: cuántas requests hizo esta key en los últimos `ventanaSeg` segundos
// (se cuenta desde el propio api_audit_log). Se llama ANTES de insertar la fila actual.
export async function llamadasRecientes(keyId: number, ventanaSeg: number): Promise<number> {
  const desde = new Date(Date.now() - ventanaSeg * 1000).toISOString()
  const { count } = await serviceClient()
    .from('api_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('key_id', keyId)
    .gte('ts', desde)
  return count ?? 0
}

// Registra una request en el log de auditoría (best-effort: nunca rompe la respuesta).
export async function auditarRequest(row: {
  storeId: string | null; keyId: number | null; endpoint: string
  desde: string | null; hasta: string | null; status: number; error?: string | null
  ip: string | null; userAgent: string | null; durationMs: number; diasDevueltos: number | null
}): Promise<void> {
  try {
    await serviceClient().from('api_audit_log').insert({
      store_id: row.storeId, key_id: row.keyId, endpoint: row.endpoint,
      desde: row.desde, hasta: row.hasta, status: row.status, error: row.error ?? null,
      ip: row.ip, user_agent: row.userAgent, duration_ms: row.durationMs, dias_devueltos: row.diasDevueltos,
    })
  } catch { /* el log no debe tumbar la respuesta */ }
}
