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
  payment?: Payment
  order?: Order
  score?: number
  amount?: number
  orderNumber?: string
  orderId?: string
  storeId?: string
  storeName?: string
  customerName?: string
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

export interface AppState {
  processedPayments: string[]
  matchLog: LogEntry[]
  recentMatches: RecentMatch[]
  pendingMatches: PendingMatch[]
  unmatchedPayments: UnmatchedPayment[]
  // Órdenes y pagos marcados manualmente como gestionados por fuera de la app
  externallyMarkedOrders: string[]   // claves "storeId-orderId"
  externallyMarkedPayments: string[] // mpPaymentId — solo pagos marcados con "No es de tiendas"
  // IDs de pagos confirmados (manual_paid/auto_paid) que se preservan después de borrar el registro
  // Solo para protección en cycle.ts — no afecta badges del frontend
  retainedPaymentIds: string[]
  lastMPCheck: string
  settings: Record<string, unknown>
  // Acumulador mensual: clave "YYYY-MM", persiste aunque se borre el registro
  monthlyStats: Record<string, MonthlyStats>
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
