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

export interface AppState {
  processedPayments: string[]
  matchLog: LogEntry[]
  recentMatches: RecentMatch[]
  pendingMatches: PendingMatch[]
  unmatchedPayments: UnmatchedPayment[]
  dismissedOrders: string[]
  lastMPCheck: string
  settings: Record<string, unknown>
}

export interface MatchResult {
  order: Order
  score: number
  scores: Record<string, number>
  matchType: string
  decision: 'auto_paid' | 'needs_review' | 'no_match'
  thirdParty: boolean
}
