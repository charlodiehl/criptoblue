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
  orderStatus?: string  // 'open' | 'cancelled' | 'closed' — viene de TiendaNube/Shopify
}

export interface Store {
  storeId: string
  storeName: string
  accessToken: string
  connectedAt: string
  platform?: 'tiendanube' | 'shopify'
}

export interface LogEntry {
  timestamp: string
  action: 'auto_paid' | 'manual_paid' | 'needs_review' | 'no_match' | 'dismissed' | 'cancelled'
  // Origen de la entrada — determina a qué tarjeta de stats pertenece:
  // 'emparejamiento' → tarjeta 1 (Pagos emparejados)
  // 'manual_pagos'   → tarjeta 2 (Marcados manualmente) — desde pestaña Pagos/Sin coincidencia
  // 'manual_ordenes' → tarjeta 2 (Marcados manualmente) — desde pestaña Órdenes
  source?: 'emparejamiento' | 'manual_pagos' | 'manual_ordenes'
  // Quién disparó el match:
  // 'cron'          → el cron automático de Vercel
  // 'manual_button' → botón ⚡ tocado por un humano
  // 'human'         → acción manual en la UI (confirmar, marcar orden, etc.)
  triggeredBy?: 'cron' | 'manual_button' | 'human'
  payment?: Payment
  order?: Order
  score?: number
  amount?: number               // Monto del pago con el que se emparejó (payment.monto)
  orderTotal?: number            // Monto de la orden en la tienda (order.total)
  orderNumber?: string
  orderId?: string
  storeId?: string
  storeName?: string
  customerName?: string
  cuitPagador?: string
  mpPaymentId?: string
  paymentReceivedAt?: string  // Cuándo llegó el pago a MercadoPago (payment.fechaPago)
  orderCreatedAt?: string     // Cuándo se creó la orden en la tienda (order.createdAt)
  hidden?: boolean            // true = oculto en la UI (botón "Borrar registro"), pero se conserva en Supabase
  copiedAt?: string           // ISO timestamp de cuando fue copiado con "Copiar nuevos registros"
}

export interface UnmatchedPayment {
  payment: Payment
  timestamp: string
  mpPaymentId?: string
  storeName?: string
}

export interface RecentMatch {
  mpPaymentId: string
  matchedAt: string
  orderId?: string
  storeId?: string
  order?: Order
  payment?: Payment
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
  // registroLog: Registro visible en la UI — nunca expira automáticamente, solo se borra con el botón "Borrar Registro"
  // Incluye: todos los emparejamientos (manuales y automáticos) + pagos vencidos sin emparejar
  registroLog: LogEntry[]
  // matchLog: log de backend para consultas del sistema — se borra automáticamente a las 48hs
  // Solo incluye emparejamientos (NO no_match). Independiente del Registro.
  matchLog: LogEntry[]
  recentMatches: RecentMatch[]
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
  lastAutoMatchAt?: string     // ISO — última vez que corrió auto-match-run
  lastAutoMatchMatched?: number // cuántos pares marcó el último auto-match (para notificar al frontend)
  currentPhase?: 'idle' | 'syncing' | 'auto-matching' // fase actual del ciclo (para indicador visual en UI)
  // Datos enriquecidos manualmente para pagos — persisten entre reevaluaciones
  // Solo aplican sobre campos que MP trae vacíos. Expiran cuando el pago vence (48hs).
  paymentOverrides: Record<string, Partial<Payment>>
  settings: Record<string, unknown>
  // Stats de las 4 tarjetas — se acumulan en tiempo real con cada match, nunca se tocan por otro proceso
  // Clave: "YYYY-MM". Se resetean naturalmente al cambiar de mes.
  persistedMonthStats: Record<string, PersistedMonthStats>
  // Pares pago+orden bloqueados por "No corresponde" — expiran a las 48hs automáticamente
  dismissedPairs: DismissedPair[]
  // Log de errores del sistema (persiste en Supabase, auto-limpia a 7 días)
  errorLog: ErrorEntry[]
  // Log de actividad interno: todas las acciones de las últimas 48hs (humano o sistema)
  activityLog: ActivityEntry[]
}

export interface ActivityEntry {
  id: string
  timestamp: string
  actor: 'human' | 'system'
  action: string
  details?: Record<string, unknown>
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
