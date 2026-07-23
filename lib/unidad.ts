// ─────────────────────────────────────────────────────────────────────────────
// UNIDADES DE NEGOCIO
//
// La app corre DOS negocios independientes sobre la MISMA infraestructura:
//
//   • criptoblue → el negocio original (todas las tiendas y billeteras de hoy).
//   • ms         → el negocio de MS, que arranca vacío.
//
// Comparten código, deploy, crons, la API de cotizaciones y la base de datos.
// NO comparten datos: cada unidad ve únicamente lo suyo. La separación se aplica
// en dos capas, y las dos son automáticas (no hay que acordarse de filtrar):
//
//   1. kv_store  → cada unidad tiene su propio PREFIJO de key.
//                  criptoblue usa 'criptoblue:…' (las keys históricas, sin migrar),
//                  ms usa 'ms:…'. Ver kvKey().
//   2. Tablas    → columna `unidad` + un proxy sobre getClient() (lib/storage.ts)
//                  que le mete el filtro a TODAS las queries y el valor a todos
//                  los inserts. Ver TABLAS_POR_UNIDAD.
//
// La unidad activa viaja por AsyncLocalStorage (contexto por request), no por
// parámetro: la setea requireUser()/getSessionUser() desde app_users.unidad, y los
// crons la setean a mano al iterar las unidades. getUnidad() TIRA ERROR si nadie la
// estableció — a propósito: preferimos romper antes que servir datos de la unidad
// equivocada.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from 'async_hooks'

export type UnidadId = 'criptoblue' | 'ms'

export interface Unidad {
  id: UnidadId
  nombre: string              // cómo se muestra en la app
  rol: string                 // nombre del rol de su super admin
  kvPrefix: string            // prefijo de sus keys en kv_store
  wallets: readonly string[]  // billeteras que opera (vacío = ninguna conectada)
}

export const UNIDADES: Record<UnidadId, Unidad> = {
  criptoblue: {
    id: 'criptoblue',
    nombre: 'CriptoBlue',
    rol: 'superadmin-criptoblue',
    // Prefijo histórico: las keys de kv_store ya se llaman así, no hay nada que migrar.
    kvPrefix: 'criptoblue',
    wallets: ['MF', 'Lacar', 'MS', 'Montemar', 'Otras'],
  },
  ms: {
    id: 'ms',
    nombre: 'MS',
    rol: 'superadmin-ms',
    kvPrefix: 'ms',
    // 'Copter MS' pasó acá en la migración de jul 2026 (antes era una "billetera de
    // terceros" dentro de CriptoBlue). 'Otras' es el cajón de pagos manuales sueltos,
    // que toda unidad necesita.
    wallets: ['Copter MS', 'Otras'],
  },
}

export const UNIDAD_DEFAULT: UnidadId = 'criptoblue'

// Orden en el que los crons recorren las unidades.
export const UNIDADES_ACTIVAS: readonly UnidadId[] = ['criptoblue', 'ms']

export function esUnidadValida(v: unknown): v is UnidadId {
  return typeof v === 'string' && v in UNIDADES
}

// Normaliza lo que venga de la base/env a una unidad válida (fallback: la default).
export function parseUnidad(v: unknown): UnidadId {
  return esUnidadValida(v) ? v : UNIDAD_DEFAULT
}

// Rol completo de un usuario, para mostrar y para los scripts de alta.
// Se COMPONE de role + unidad: en la base no hay un rol 'superadmin-ms' suelto, hay
// role='admin' + unidad='ms'. Esta es la única función que arma ese nombre.
export function rolCompleto(role: string, unidad: UnidadId): string {
  return role === 'admin' ? UNIDADES[unidad].rol : role
}

// ─── Contexto de la unidad activa ────────────────────────────────────────────

const almacen = new AsyncLocalStorage<UnidadId>()

// Unidad de la request en curso. Tira error si nadie la estableció (fail-closed):
// sin unidad NO se sirve nada, en vez de caer por default en criptoblue y filtrar
// datos de un negocio al otro.
export function getUnidad(): UnidadId {
  const u = almacen.getStore()
  if (!u) {
    throw new Error(
      'Unidad de negocio no establecida. Toda lectura/escritura de datos tiene que ' +
      'correr después de requireUser()/getSessionUser(), o dentro de runEnUnidad().',
    )
  }
  return u
}

// Igual que getUnidad() pero sin romper: null si no hay contexto. Solo para
// diagnósticos y logs — nunca para decidir qué datos servir.
export function getUnidadOpcional(): UnidadId | null {
  return almacen.getStore() ?? null
}

// Establece la unidad para el resto de la ejecución en curso.
//
// ⚠️ HAY QUE LLAMARLA DESDE EL PROPIO CUERPO DEL HANDLER, no desde una función
// anidada que el handler haga `await`. En el runtime de Next, el `enterWith` que
// hace una función anidada NO le llega a quien la llamó: el contexto de la
// continuación se captura antes, así que el cambio muere con esa función.
// (Medido: A=anidado → null; B=frame propio → OK; C=runEnUnidad → OK.)
//
// Por eso el patrón de las rutas es:
//     const auth = await requireUser()
//     if ('error' in auth) return auth.error
//     setUnidad(auth.user.unidad)     // ← acá, en el frame de la ruta
//
// Y por eso los crons y los webhooks usan runEnUnidad(), que no tiene este problema.
export function setUnidad(unidad: UnidadId): void {
  almacen.enterWith(unidad)
}

// Corre `fn` dentro de una unidad. Es la forma que usan los crons y los webhooks
// para procesar varias unidades en una misma invocación sin pisarse.
export function runEnUnidad<T>(unidad: UnidadId, fn: () => Promise<T>): Promise<T> {
  return almacen.run(unidad, fn)
}

// Corre `fn` una vez por unidad, EN SERIE, y devuelve el resultado de cada una.
// Así es como se comparte la infraestructura: hay UN solo cron de Vercel, que en
// cada corrida procesa todas las unidades una después de la otra.
// En serie y no en paralelo a propósito: cada unidad toma el lock global de estado
// y pega contra las mismas APIs externas.
// Un error en una unidad NO frena a las demás: se devuelve como `error`.
export async function porCadaUnidad<T>(
  fn: (unidad: UnidadId) => Promise<T>,
): Promise<Record<string, T | { error: string }>> {
  const out: Record<string, T | { error: string }> = {}
  for (const u of UNIDADES_ACTIVAS) {
    try {
      out[u] = await runEnUnidad(u, () => fn(u))
    } catch (err) {
      out[u] = { error: String(err) }
    }
  }
  return out
}

// ─── Helpers derivados de la unidad activa ───────────────────────────────────

// Key de kv_store namespaceada. kvKey('state') → 'criptoblue:state' | 'ms:state'.
export function kvKey(nombre: string): string {
  return `${UNIDADES[getUnidad()].kvPrefix}:${nombre}`
}

// Billeteras de la unidad activa. Reemplaza al WALLETS global de config.ts en todo
// lo que sea server-side; el cliente las recibe por prop desde el server component.
export function walletsDeUnidad(): readonly string[] {
  return UNIDADES[getUnidad()].wallets
}

export function unidadActiva(): Unidad {
  return UNIDADES[getUnidad()]
}

// A qué unidad pertenece una billetera. Lo usan los webhooks de pagos (que llegan
// sin sesión) para saber en qué unidad meter la plata que entró.
//
// Es la pieza que hace barata la migración: cuando una billetera cambie de unidad,
// se la mueve en UNIDADES y sus pagos empiezan a entrar solos en la nueva, sin
// tocar el webhook.
export function unidadDeBilletera(wallet: string): UnidadId | null {
  for (const u of UNIDADES_ACTIVAS) {
    if (UNIDADES[u].wallets.includes(wallet)) return u
  }
  return null
}

// ─── Tablas que se filtran por unidad ────────────────────────────────────────
// Toda tabla con datos de negocio lleva la columna `unidad`. El proxy de
// getClient() (lib/storage.ts) le agrega el filtro a los select/update/delete y el
// valor a los insert/upsert, así ninguna query se puede olvidar de acotarse.
//
// Fuera de la lista quedan a propósito:
//   kv_store / kv_notifications → se separan por PREFIJO de key, no por columna.
//   push_subscriptions / notification_prefs → son del usuario, y el usuario ya
//   pertenece a una sola unidad.
export const TABLAS_POR_UNIDAD: ReadonlySet<string> = new Set([
  'app_users',
  'registro_log',
  'balance_movements',
  'wallet_movements',
  'refunds',
  'refund_requests',
  'transfer_requests',
  'store_api_keys',
  'api_audit_log',
])
