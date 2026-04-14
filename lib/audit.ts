/**
 * audit.ts — DESACTIVADO
 *
 * El sistema de audit fue desactivado para reducir Disk IO en Supabase.
 * Todas las funciones son no-ops. El registroLog en criptoblue:logs
 * conserva toda la información de matches que se necesita en producción.
 *
 * Para reactivar: restaurar la implementación original desde git.
 */

import type { AuditEntry, AuditCategory, AuditResult } from './types'

export type AuditParams = {
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
}

export async function audit(_params: AuditParams): Promise<void> {}

export async function auditBatch(_entries: AuditParams[]): Promise<void> {}

export async function auditMatch(_params: {
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
}): Promise<void> {}

export async function auditApiCall(_params: {
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
}): Promise<void> {}

export async function auditError(_params: {
  action: string
  component: string
  message: string
  error: string
  endpoint?: string
  meta?: Record<string, unknown>
}): Promise<void> {}

export async function cleanupAuditLogs(): Promise<number> { return 0 }

export async function queryAudit(_params: {
  from: Date
  to?: Date
  category?: AuditCategory
  action?: string
  mpPaymentId?: string
  orderNumber?: string
  storeId?: string
}): Promise<AuditEntry[]> { return [] }
