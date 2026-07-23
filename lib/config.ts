// Hard cutoffs — nada anterior a estas fechas debe aparecer
// Argentina (ART) = UTC-3

// Pagos: 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_PAYMENTS = new Date('2026-03-28T00:00:00.000Z')

// Órdenes: igual que pagos — 27/03/2026 21:00 ART → 00:00 UTC 28/03
export const HARD_CUTOFF_ORDERS = new Date('2026-03-28T00:00:00.000Z')

// Fecha de corte del BALANCE por tienda: solo las órdenes registradas desde este
// momento generan movimiento de ingreso (balance_movements). Lo anterior se
// representa con el saldo inicial por tienda (scripts/cargar-saldo-inicial.mjs),
// cargado como un 'ajuste' fechado justo en el corte.
// 12/7/2026 00:00 ART. El saldo inicial se carga como 'ajuste' fechado el 11/7.
export const BALANCE_CUTOFF = new Date('2026-07-12T00:00:00-03:00')

// ─── Ventanas de tiempo (centralizadas para evitar desincronización) ──────────

// Ventana de detección de "monto duplicado": cuántas horas antes del pago
// se buscan otras órdenes con el mismo monto al computar sameMontoCount.
export const SAMEMONTO_WINDOW_HOURS = 24

// Ventana mínima del cache de órdenes (rolling desde "ahora") cuando no hay
// pagos viejos en cola. Si hay pagos sin emparejar, el cache se extiende
// automáticamente para cubrir su ventana de detección.
export const ORDER_CACHE_MIN_HOURS = 48

// Buffer extra al fetchear órdenes para cubrir la ventana de detección,
// para que órdenes creadas justo en el borde no queden fuera por segundos.
export const ORDER_CACHE_BUFFER_HOURS = 1

// Ventana del rolling de pagos en MP (cuántas horas hacia atrás se traen).
export const PAYMENT_CACHE_HOURS = 48

// Umbral de diferencia entre monto pagado y total de orden a partir del cual
// los flujos de marcado manual exigen confirmación explícita adicional.
// Aplica a manual-log (PaymentsListTab) y mark-order-paid-manual (OrdersListTab).
// El flujo de Emparejamiento manual ya muestra la diferencia visualmente.
export const MONTO_DIFF_WARNING_THRESHOLD = 5000

// Mapeo de fuente de pago → nombre amigable para el Registro
// Para agregar un nuevo medio de pago, solo agregar una entrada acá
export const PAYMENT_SOURCE_NAMES: Record<string, string> = {
  mercadopago: 'Mileidy',
  // Los pagos de Fiwind entran a la misma billetera "MF" → se muestran así.
  // El source interno sigue siendo 'fiwind' (trazabilidad del origen webhook).
  fiwind: 'MF',
  // Los pagos cargados desde planilla Excel son de la billetera "Lacar".
  lacar: 'Lacar',
  // Los pagos que manda directo el sistema de "Notificador" (webhook a webhook)
  // son de la billetera "MS".
  notificador: 'MS',
  // Los pagos de Montemar pay entran por email (Apps Script → webhook, igual que
  // Fiwind) a la billetera "Montemar".
  montemar: 'Montemar',
  // Los pagos de ExchangeCopter entran por email (Apps Script → webhook) a "Copter MS".
  copter: 'Copter MS',
}

// CATÁLOGO GLOBAL de billeteras del sistema: todos los nombres que existen, de
// cualquier unidad de negocio. Sirve para reconocer un source y mandarlo a la
// billetera correcta (resolveWallet en lib/utils.ts).
//
// OJO: NO es la lista que ve un usuario. Cada unidad de negocio opera solo las
// suyas — esa lista vive en UNIDADES[...].wallets (lib/unidad.ts) y se lee con
// walletsDeUnidad(). Al agregar una billetera nueva hay que sumarla en los dos
// lados: acá (catálogo) y en su unidad.
//
// Para agregar una billetera nueva: sumarla acá y mapear sus fuentes de pago en
// PAYMENT_SOURCE_TO_WALLET.
// "Otras" es un cajón para pagos manuales que no entraron por ninguna billetera
// conocida: su source se codifica como `otras:<nombre libre>` y NO cobra comisión.
export const WALLETS = ['MF', 'Lacar', 'MS', 'Montemar', 'Copter MS', 'Otras'] as const

// SEGURO: todo pago que entra al registro sin una billetera identificable (sin
// payment, source vacío o desconocido) se guarda con este source → cae en "Otras".
// Ningún pago del registro puede quedar sin billetera.
export const SOURCE_SIN_BILLETERA = 'otras:Sin identificar'

// Tolerancia general de monto para dar la señal en verde (pago vs total de la orden).
export const MONTO_TOLERANCIA_ARS = 10

// Tiendas que aplican un descuento que NO se refleja en el total de la orden: el pago
// llega POR DEBAJO del total, siempre en el mismo %. Para esas, el monto cuenta como
// coincidente si la diferencia hacia abajo cae DENTRO DE LA BANDA del descuento.
//
// Es una banda estrecha y no un rango abierto (0…max) a propósito: si se aceptara
// cualquier diferencia menor al tope, un pago 5% o 10% más chico —que NO se explica
// por el descuento y probablemente sea un error— pasaría como válido.
// El ±0,1 alrededor del 15% absorbe los redondeos del cálculo del descuento.
//
// Asimétrico también a propósito: por arriba sigue valiendo solo MONTO_TOLERANCIA_ARS
// (un pago de MÁS no se explica por un descuento).
export const DESCUENTO_NO_REFLEJADO: Record<string, { min: number; max: number }> = {
  'v0nirt-tc.myshopify.com': { min: 14.9, max: 15.1 },   // Bambua: descuento del 15%
}

// Mapeo de fuente de pago (payment.source) → billetera a la que pertenece el DINERO
// (para el saldo de cada billetera). NO acota el emparejamiento: cualquier pago puede
// emparejar con cualquier tienda.
export const PAYMENT_SOURCE_TO_WALLET: Record<string, string> = {
  mercadopago: 'MF',
  fiwind: 'MF',
  lacar: 'Lacar',
  notificador: 'MS',
  montemar: 'Montemar',
  copter: 'Copter MS',
}

// ─── Terceros: billeteras cuyo dinero es de terceros ──────────────────────────
// Sus pagos van a su propia pestaña ("Pagos de terceros"), quedan FUERA de todas las
// métricas y del conteo del mes, y emparejan EXCLUSIVAMENTE con órdenes de tiendas de
// terceros (y al revés: una orden de tercero solo empareja con un pago de tercero).
export const BILLETERAS_TERCEROS: ReadonlySet<string> = new Set([
  'Copter MS',
])

export function esBilleteraDeTercero(wallet: string | null | undefined): boolean {
  return !!wallet && BILLETERAS_TERCEROS.has(wallet)
}
// ¿El pago viene de una billetera de terceros? (por su payment.source)
export function esPagoDeTercero(source: string | null | undefined): boolean {
  return !!source && esBilleteraDeTercero(PAYMENT_SOURCE_TO_WALLET[source])
}

// Billeteras cuyos pagos sin emparejar NUNCA vencen: no se purgan de la cola ni
// desaparecen de la vista por antigüedad (ignoran el rolling de 48hs), mientras
// sigan sin emparejar y sin marcar "No es de tiendas". Al emparejarse o marcarse,
// vuelven al comportamiento normal de expiración a las 48hs.
// MF y Montemar quedaron desconectadas (jul 2026): salen de esta lista para que
// cualquier pago rezagado de esos medios expire solo por antigüedad.
export const WALLETS_SIN_VENCIMIENTO: readonly string[] = ['Lacar', 'MS', 'Copter MS']

// MercadoPago desconectado (jul 2026): se cerró la billetera "MF" (MercadoPago +
// Fiwind). El ciclo cada 5 min ya NO pide pagos a MercadoPago (ver lib/cycle.ts).
// El código de traída se conserva para poder reactivarlo si hiciera falta:
// poner en true y MP vuelve a ingresar pagos a la cola.
export const MERCADOPAGO_ACTIVO = false

// Tiendas de "terceros": sus órdenes NO emparejan con las billeteras actuales —
// esperan una billetera dedicada que todavía no existe. Quedan FUERA del auto-match
// y del emparejamiento manual con la cola; se listan aparte en la pestaña "Órdenes de
// terceros". Cuando exista la billetera dedicada, se mapea la tienda a esa billetera.
export const TIENDAS_TERCEROS: ReadonlySet<string> = new Set([
  '7284674', // Hemat
])

export function esOrdenDeTercero(storeId: string | null | undefined): boolean {
  return !!storeId && TIENDAS_TERCEROS.has(storeId)
}

export const CONFIG = {
  tiendanube: {
    // App de Tiendanube (client_id + secret). Configurables por env para poder cambiar
    // de app sin tocar código: si no hay env, cae en la app histórica 27051.
    clientId: process.env.CRIPTOBLUE_TN_CLIENT_ID || '27051',
    clientSecret: process.env.CRIPTOBLUE_TN_CLIENT_SECRET || '',
    apiBase: 'https://api.tiendanube.com/v1',
    userAgent: 'CriptoBlue Agent (padeleroapp@gmail.com)',
  },
  mercadopago: {
    accessToken: process.env.CRIPTOBLUE_MP_ACCESS_TOKEN || '',
    apiBase: 'https://api.mercadopago.com',
  },
  shopify: {
    clientId: process.env.CRIPTOBLUE_SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.CRIPTOBLUE_SHOPIFY_CLIENT_SECRET || '',
    apiVersion: '2026-01',
    scopes: 'read_orders,write_orders,read_customers',
  },
}
