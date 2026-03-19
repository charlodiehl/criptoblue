export interface Payment {
  mpPaymentId: string
  monto: number
  nombrePagador: string
  emailPagador: string
  cuitPagador: string
  referencia: string
  operationId: string
  metodoPago: string
  fechaPago: string
  status: string
  source?: string          // clave del medio de pago: 'mercadopago', etc.
  extractionConfidence?: number
  rawData: object
}

export interface Order {
  orderId: string
  orderNumber: string
  total: number
  customerName: string
  customerEmail: string
  customerCuit: string
  createdAt: string
  gateway: string
  storeId: string
  storeName: string
}

export interface Store {
  storeId: string
  storeName: string
  accessToken: string
  connectedAt: string
}

export interface PendingMatch {
  payment: Payment
  order: Order
  score: number
  scores: Record<string, number>
  matchType: string
  thirdParty: boolean
  matchedAt: string
  mpPaymentId?: string
  storeName?: string
}

export interface LogEntry {
  timestamp: string
  action: 'auto_paid' | 'manual_paid' | 'needs_review' | 'no_match' | 'dismissed' | 'cancelled'
  // Origen de la entrada — determina a qué tarjeta de stats pertenece:
  // 'emparejamiento' → tarjeta 1 (Pagos emparejados)
  // 'manual_pagos'   → tarjeta 2 (Marcados manualmente) — desde pestaña Pagos/Sin coincidencia
  // 'manual_ordenes' → tarjeta 2 (Marcados manualmente) — desde pestaña Órdenes
  source?: 'emparejamiento' | 'manual_pagos' | 'manual_ordenes'
  payment?: Payment
  order?: Order
  score?: number
  amount?: number
  orderNumber?: string
  orderId?: string
  storeId?: string
  storeName?: string
  customerName?: string
  cuitPagador?: string
  mpPaymentId?: string
}

export interface UnmatchedPayment {
  payment: Payment
  timestamp: string
  mpPaymentId?: string
  storeName?: string
}

export interface Stats {
  paidThisMonth: number
  paidVolumeThisMonth: number
  pendingOrders: number
  pendingPayments: number
}

export interface RecentMatch {
  mpPaymentId: string
  matchedAt: string
  orderId?: string
  storeId?: string
  order?: Order
  payment?: Payment
}

export interface MonthlyStats {
  count: number
  volume: number
}

// Stats mensuales persistentes por mes — sobreviven al borrado del registro
export interface PersistedMonthStats {
  matchedCount: number
  matchedVolume: number
  manualCount: number
  manualVolume: number
}

export interface ExternalPaymentMark {
  id: string        // mpPaymentId
  markedAt: string  // ISO timestamp — usado para expirar a las 48h igual que el resto
}

// Par pago+orden bloqueado (click en "No corresponde") — expira a las 48hs
export interface DismissedPair {
  mpPaymentId: string
  orderId: string
  storeId: string
  dismissedAt: string  // ISO timestamp — se elimina automáticamente a las 48hs
}

export interface AppState {
  processedPayments: string[]
  matchLog: LogEntry[]
  recentMatches: RecentMatch[]
  pendingMatches: PendingMatch[]
  unmatchedPayments: UnmatchedPayment[]
  // Órdenes y pagos marcados manualmente como gestionados por fuera de la app
  externallyMarkedOrders: string[]          // claves "storeId-orderId"
  externallyMarkedPayments: ExternalPaymentMark[] // pagos marcados con "No es de tiendas", expiran a las 48h
  // IDs de pagos confirmados (manual_paid/auto_paid) que se preservan después de borrar el registro
  // Solo para protección en cycle.ts — no afecta badges del frontend
  retainedPaymentIds: string[]
  // Cache de órdenes de TiendaNube — se actualiza en cada ciclo del cron (cada 5min)
  // Todos los clientes leen de acá para ver exactamente las mismas órdenes
  cachedOrders: Order[]
  cachedOrdersAt: string  // ISO timestamp del último cache exitoso
  lastMPCheck: string
  settings: Record<string, unknown>
  // Acumulador mensual legacy (no se usa en tarjetas nuevas)
  monthlyStats: Record<string, MonthlyStats>
  // Stats de las 4 tarjetas persistidas por mes — NO se borran con el registro
  // Clave: "YYYY-MM". Se acumulan en DELETE /api/log antes de vaciar el matchLog.
  persistedMonthStats: Record<string, PersistedMonthStats>
  // Pares pago+orden bloqueados por "No corresponde" — expiran a las 48hs automáticamente
  dismissedPairs: DismissedPair[]
  // Log de errores del sistema (persiste en Supabase, auto-limpia a 30 días)
  errorLog: ErrorEntry[]
  // Log de actividad interno: todas las acciones de las últimas 24hs (humano o sistema)
  activityLog: ActivityEntry[]
}

export interface ActivityEntry {
  id: string
  timestamp: string
  actor: 'human' | 'system'
  action: string
  details?: Record<string, unknown>
}

export interface MatchResult {
  order: Order
  score: number
  scores: Record<string, number>
  matchType: string
  decision: 'auto_paid' | 'needs_review' | 'no_match'
  thirdParty: boolean
}

export interface ErrorEntry {
  id: string
  timestamp: string
  source: string   // 'cycle' | 'mercadopago' | 'tiendanube' | 'manual-match' | 'reevaluar' | etc.
  level: 'error' | 'warning' | 'info'
  message: string
  context?: Record<string, unknown>
  resolved: boolean
}
