// ─────────────────────────────────────────────────────────────────────────────
// Los CORTES (desde cuándo existe cada cosa) ya NO viven acá: son por UNIDAD DE
// NEGOCIO, porque cada una arranca en una fecha distinta. Están en lib/unidad.ts
// (UNIDADES[x].cutoffs) y se leen con cutoffPagos() / cutoffOrdenes() /
// cutoffBalance(). El cliente los recibe por /api/mi-unidad.
//
// No se dejan constantes globales a propósito: una sola llamada a la constante
// vieja desde código nuevo le aplicaría a MS el corte de CriptoBlue en silencio.
// ─────────────────────────────────────────────────────────────────────────────

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
  // HISTÓRICO: el bot de "Notificador" ya no carga pagos (los de MS entran por
  // email, ver 'lbfinanzas'), pero hay ~2.200 pagos guardados con este source.
  // Sin el mapeo caerían en "Otras" y se rompería el saldo y el historial de MS.
  notificador: 'MS',
  // Los pagos de LB Finanzas entran por email a la misma billetera "MS": es el
  // mismo dinero, cambia por dónde nos enteramos. El source se conserva distinto
  // para no perder la trazabilidad del origen.
  lbfinanzas: 'MS',
  // Los pagos de Montemar pay entran por email (Apps Script → webhook, igual que
  // Fiwind) a la billetera "Montemar".
  montemar: 'Montemar',
  // Los pagos de ExchangeCopter entran por email (Apps Script → webhook) a "Copter Hemat".
  copter: 'Copter Hemat',
  // Los pagos de Bitso entran por email (Apps Script → webhook) a "Bitso FluoGames".
  bitso: 'Bitso FluoGames',
  // ESPEJO de los pagos de LB Finanzas en la unidad MS. Es el MISMO dinero que entra
  // a la billetera "MS" de CriptoBlue: el pago se escribe dos veces, una en cada
  // unidad, y nunca se mezclan porque cada unidad filtra por su columna `unidad`.
  // MS lo quiere en su propio libro, sin emparejar ordenes.
  lbcriptoblue: 'LB CriptoBlue',
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
export const WALLETS = ['MF', 'Lacar', 'MS', 'Montemar', 'Copter Hemat', 'Bitso FluoGames', 'LB CriptoBlue', 'Otras'] as const

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
  notificador: 'MS',   // histórico: ya no entra nada por acá (ver PAYMENT_SOURCE_NAMES)
  lbfinanzas: 'MS',
  montemar: 'Montemar',
  copter: 'Copter Hemat',
  bitso: 'Bitso FluoGames',
  lbcriptoblue: 'LB CriptoBlue',
}

// Billeteras cuyos pagos sin emparejar NUNCA vencen: no se purgan de la cola ni
// desaparecen de la vista por antigüedad (ignoran el rolling de 48hs), mientras
// sigan sin emparejar y sin marcar "No es de tiendas". Al emparejarse o marcarse,
// vuelven al comportamiento normal de expiración a las 48hs.
// MF y Montemar quedaron desconectadas (jul 2026): salen de esta lista para que
// cualquier pago rezagado de esos medios expire solo por antigüedad.
export const WALLETS_SIN_VENCIMIENTO: readonly string[] = ['Lacar', 'MS', 'Copter Hemat']

// MercadoPago desconectado (jul 2026): se cerró la billetera "MF" (MercadoPago +
// Fiwind). El ciclo cada 5 min ya NO pide pagos a MercadoPago (ver lib/cycle.ts).
// El código de traída se conserva para poder reactivarlo si hiciera falta:
// poner en true y MP vuelve a ingresar pagos a la cola.
export const MERCADOPAGO_ACTIVO = false

// ─── Billeteras que NO emparejan órdenes ─────────────────────────────────────
// Son registro financiero puro: la plata entra, queda asentada en el extracto de la
// billetera, y NUNCA se ofrece para emparejar con una orden. Sus pagos figuran
// siempre como "Pendiente" y sin tienda, porque no hay ninguna que los reclame.
//
// No pasan por la cola (hot state) como el resto: se escriben derecho al registro con
// la acción ACCION_SOLO_BILLETERA. La cola es un único JSON que se reescribe en cada
// ciclo, y un pago que nunca empareja se quedaría ahí para siempre — a ~100 por día
// serían 36.000 al año en ese blob. El registro es una tabla y escala.
//
// Consecuencia de no estar en la cola: tampoco aparecen en la pestaña Pagos, ni en
// "sin coincidencia", ni en el emparejamiento manual, ni las mira el auto-match. Eso
// sale gratis, no hay que filtrarlas en cada consumidor.
export const WALLETS_SIN_EMPAREJAMIENTO: readonly string[] = ['Bitso FluoGames', 'LB CriptoBlue']

export const billeteraNoEmpareja = (wallet: string): boolean =>
  WALLETS_SIN_EMPAREJAMIENTO.includes(wallet)

// Acción con la que se asientan esos pagos en registro_log. NO es un emparejamiento:
// no lleva tienda ni orden, y el extracto de la billetera la muestra como pendiente.
export const ACCION_SOLO_BILLETERA = 'pago_billetera' as const

// ─── Desde cuándo valen los avisos de LB Finanzas ────────────────────────────
// Todo depósito ANTERIOR a este instante ya entró por el bot de Notificador: los
// avisos que estaban en la casilla cuando se conectó el canal de email son de pagos
// YA cargados, y volver a cargarlos duplicaría la plata en la cola y en el saldo.
//
// El control principal es el puntero del Apps Script, que solo mira mails nuevos.
// Esto es la red: si alguien vuelve a ejecutar inicializar() y el puntero retrocede,
// el servidor igual descarta lo viejo. Por eso vive acá y no en el script.
//
// Se compara contra la FECHA DEL DEPÓSITO que informa el aviso, no contra la fecha
// del email: un mail reenviado tarde no puede colar un pago viejo.
export const LBFINANZAS_DESDE = new Date('2026-07-29T16:34:00.000Z')   // 29/07/2026 13:34 ART

// NOTA: acá vivía el circuito de "terceros" (Hemat + Copter MS), que mantenía sus
// órdenes y pagos separados del resto DENTRO de la misma app: fuera de las métricas,
// en pestañas aparte y emparejando solo entre ellos. Se retiró en jul 2026: ahora
// Hemat y Copter MS son una UNIDAD DE NEGOCIO propia (ver lib/unidad.ts), que ya no
// comparte datos con CriptoBlue. Dentro de su unidad son una tienda y una billetera
// normales, y aquellas restricciones no protegían nada.

// ─── Tiendas cuyo saldo se lleva en PESOS ────────────────────────────────────
// El saldo de una tienda se lleva normalmente en USDT: los ingresos se convierten
// a la cotización del momento del emparejamiento y los retiros se descuentan en
// USDT. Para estas tiendas el saldo es en ARS y punto: no hay conversión, y las
// columnas de cotización y equivalente USDT del registro se muestran como "—".
//
// Tiene una consecuencia en el libro mayor: para estas tiendas el egreso de una
// transferencia SÍ escribe su monto en la columna `ars` (para el resto queda en 0,
// porque su saldo no vive en pesos). Ver registrarEgresoTransferencia.
export const TIENDAS_SALDO_EN_PESOS: readonly string[] = [
  '7284674',   // Hemat (unidad MS)
]

export const tiendaLlevaSaldoEnPesos = (storeId: string): boolean =>
  TIENDAS_SALDO_EN_PESOS.includes(storeId)

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
