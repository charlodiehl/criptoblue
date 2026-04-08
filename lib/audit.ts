/**
 * audit.ts — Sistema de audit log unificado
 *
 * Registra TODOS los eventos de la app en keys diarios de Supabase:
 *   criptoblue:audit:2026-04-08 → AuditEntry[]
 *
 * Fire-and-forget: si falla, no rompe la app.
 * Retención: 30 días, cleanup automático en cada ciclo cron.
 */

import { kvGet, kvSet, getClient } from './storage'
import type { AuditEntry, AuditCategory, AuditResult } from './types'

const AUDIT_KEY_PREFIX = 'criptoblue:audit:'

// Key para la fecha actual en hora Argentina (UTC-3)
function auditKeyForDate(date: Date): string {
  const arg = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return `${AUDIT_KEY_PREFIX}${arg.toISOString().slice(0, 10)}`
}

// ─── Core ────────────────────────────────────────────────────────────────────

export async function audit(params: {
  category: AuditCategory
  action: string
  result: AuditResult
  actor: 'system' | 'human' | 'cron'
  component: string
  message: string
  endpoint?: string
  durationMs?: number
  mpPaymentId?: string
  orderId?: string
  orderNumber?: string
  storeId?: string
  storeName?: string
  amount?: number
  error?: string
  statusCode?: number
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const entry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      ...params,
    }
    const key = auditKeyForDate(new Date())
    const existing = await kvGet<AuditEntry[]>(key) ?? []
    existing.push(entry)
    await kvSet(key, existing)
  } catch {
    // Fire-and-forget: audit no debe romper la app
  }
}

// ─── Convenience wrappers ────────────────────────────────────────────────────

export async function auditMatch(params: {
  action: string
  actor: 'system' | 'human' | 'cron'
  component: string
  mpPaymentId: string
  orderId: string
  orderNumber?: string
  storeId: string
  storeName?: string
  amount?: number
  result: AuditResult
  message: string
  meta?: Record<string, unknown>
}): Promise<void> {
  return audit({ category: 'match', ...params })
}

export async function auditApiCall(params: {
  action: string
  component: string
  endpoint?: string
  storeId?: string
  storeName?: string
  statusCode?: number
  durationMs?: number
  result: AuditResult
  message: string
  error?: string
  meta?: Record<string, unknown>
}): Promise<void> {
  return audit({ category: 'api_call', actor: 'system', ...params })
}

export async function auditError(params: {
  action: string
  component: string
  message: string
  error: string
  endpoint?: string
  meta?: Record<string, unknown>
}): Promise<void> {
  return audit({ category: 'error', result: 'failure', actor: 'system', ...params })
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

// Eliminar keys de audit con más de 30 días. Llamar al final de cada ciclo cron.
export async function cleanupAuditLogs(): Promise<number> {
  try {
    const supabase = getClient()
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const cutoffKey = auditKeyForDate(cutoff)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('kv_store') as any)
      .delete()
      .like('key', `${AUDIT_KEY_PREFIX}%`)
      .lt('key', cutoffKey)
      .select('key')

    if (error) return 0
    return data?.length ?? 0
  } catch {
    return 0
  }
}

// ─── Query ───────────────────────────────────────────────────────────────────

export async function queryAudit(params: {
  from: Date
  to?: Date
  category?: AuditCategory
  action?: string
  mpPaymentId?: string
  orderNumber?: string
  storeId?: string
}): Promise<AuditEntry[]> {
  const to = params.to ?? new Date()
  const results: AuditEntry[] = []

  const current = new Date(params.from)
  while (current <= to) {
    const key = auditKeyForDate(current)
    const entries = await kvGet<AuditEntry[]>(key)
    if (entries) results.push(...entries)
    current.setDate(current.getDate() + 1)
  }

  return results.filter(e => {
    if (params.category && e.category !== params.category) return false
    if (params.action && !e.action.includes(params.action)) return false
    if (params.mpPaymentId && e.mpPaymentId !== params.mpPaymentId) return false
    if (params.orderNumber && e.orderNumber !== params.orderNumber) return false
    if (params.storeId && e.storeId !== params.storeId) return false
    return true
  })
}
