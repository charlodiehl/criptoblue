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
  walletId?: string      // billetera de la tienda (copiada de Store.walletId al cachear la orden)
}

export interface Store {
  storeId: string
  storeName: string
  accessToken: string
  connectedAt: string
  platform?: 'tiendanube' | 'shopify'
  // Billetera por la que esta tienda recibe pagos (ej: 'MF', 'Lacar'). Acota el
  // universo de emparejamiento: un pago solo busca candidatas entre tiendas de
  // su misma billetera. Sin asignar → la tienda es candidata para cualquier pago.
  walletId?: string
}

export interface LogEntry {
  timestamp: string
  action: 'auto_paid' | 'manual_paid' | 'needs_review' | 'no_match' | 'dismissed' | 'cancelled'
  // Origen de la entrada — determina a qué tarjeta de stats pertenece:
  // 'emparejamiento' → tarjeta 1 (Pagos emparejados)
  // 'manual_pagos'   → tarjeta 2 (Marcados manualmente) — desde pestaña Pagos/Sin coincidencia
  // 'manual_ordenes' → tarjeta 2 (Marcados manualmente) — desde pestaña Órdenes
  // 'tienda_buscar'  → tarjeta 1 (cuenta como emparejado) — pago reclamado por una
  //                    tienda desde su portal (Buscar pagos → Reclamar)
  source?: 'emparejamiento' | 'manual_pagos' | 'manual_ordenes' | 'tienda_buscar'
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
  // El registro (emparejamientos manuales y automáticos) vive en la tabla
  // relacional registro_log — ya no forma parte de AppState. Ver lib/registro.ts.
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
  source: string   // 'cycle' | 'mercadopago' | 'tiendanube' | 'manual-match' | 'reevaluar' | 'notificador' | etc.
  level: 'error' | 'warning' | 'info'
  message: string
  context?: Record<string, unknown>
  resolved: boolean
  // "Visto" por el humano en el centro de errores (campana del header). Distinto de
  // `resolved` (que indica si el problema se solucionó y controla la limpieza a 7 días).
  // El badge de la campana cuenta los errores con seen !== true.
  seen?: boolean
}

// ─── Portal de tiendas / Administración financiera ─────────────────────────

// Usuario de la app (tabla app_users, carga manual con scripts/agregar-usuario.mjs)
export interface AppUser {
  email: string                  // lowercase — es la PK
  role: 'admin' | 'tienda'
  storeId?: string | null        // obligatorio para role='tienda'
  displayName?: string | null
}

export type TransferTipo = 'ars' | 'usd' | 'usdt' | 'usd_billete' | 'ars_billete'
export type TransferEstado = 'pendiente' | 'pagada'

// Moneda con la que el admin descuenta el saldo al pagar una solicitud
export type DescuentoMoneda = 'USDT' | 'USD' | 'ARS' | 'USD_BILLETE' | 'ARS_BILLETE'

// Descuento aplicado al pagar una solicitud (tasas obligatorias según moneda —
// ver calcularDescuento en lib/balance.ts, única fuente del cálculo)
export interface TransferDescuento {
  moneda: DescuentoMoneda
  monto: number                  // en la moneda retirada
  cotizacionUsdtArs?: number     // requerida para ARS / ARS_BILLETE
  tasaUsdtArs?: number           // requerida para USDT
  tasaUsdArs?: number            // requerida para USD / USD_BILLETE
  tasaUsdUsdt?: number           // requerida para USD / USD_BILLETE
  arsDescontado: number          // resultado (positivo; el movimiento lo guarda en negativo)
  usdtDescontado: number
}

// Solicitud de transferencia de una tienda (tabla transfer_requests)
export interface TransferRequest {
  id: number
  storeId: string
  tipo: TransferTipo
  estado: TransferEstado
  // Campos del formulario según tipo:
  //  ars:  { cbu, montoArs, nombreBeneficiario?, cuitBeneficiario? }
  //  usd:  { numeroCuenta, montoUsd, nombreCompleto, domicilio }
  //  usdt: { wallet, blockchain, montoUsdt }
  datos: Record<string, string | number>
  createdBy: string              // email
  createdAt: string
  paidAt?: string | null
  paidBy?: string | null
  comprobantePath?: string | null // path en el bucket 'comprobantes'
  descuento?: TransferDescuento | null
}

// Movimiento del libro mayor de balance por tienda (tabla balance_movements)
export interface BalanceMovement {
  id: number
  storeId: string
  tipo: 'ingreso_orden' | 'egreso_transferencia' | 'ajuste'
  fecha: string
  ars: number                    // SIGNADO: ingresos +, egresos −
  usdt: number | null            // SIGNADO; null = cotización pendiente
  usdtRate: number | null
  rateSource: 'api' | 'manual' | 'pendiente'
  refRegistroId?: number | null
  refTransferId?: number | null
  descripcion?: string | null
}

// Balance agregado de una tienda
export interface StoreBalance {
  storeId: string
  ars: number
  usdt: number
  pendientes: number             // movimientos sin cotización (el saldo USDT es parcial)
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export type AuditCategory = 'match' | 'user_action' | 'api_call' | 'system' | 'lock' | 'error' | 'data'
export type AuditResult = 'success' | 'failure' | 'skipped' | 'partial' | 'warning'

export interface AuditEntry {
  id: string
  ts: string                    // ISO 8601
  category: AuditCategory
  action: string                // machine-readable: 'auto_match.paid', 'api.tn.mark_paid', etc.
  result: AuditResult
  actor: 'system' | 'human' | 'cron'
  component: string             // 'auto-match-runner' | 'cycle' | 'api/manual-match' | etc.
  message: string               // human-readable
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
