import { CONFIG } from './config'
import { kvKey } from './unidad'
// El cliente sale de lib/storage: es el ÚNICO que acota las queries a la unidad de
// negocio de la request. Este módulo tenía el suyo propio, crudo, y por eso sus tablas
// se leían sin filtrar (ver lib/unidad.ts).
import { getClient } from './storage'

// ─────────────────────────────────────────────────────────────────────────────
// "Bala cargada" de Shopify: como Shopify obliga a una app por tienda, el admin
// carga las credenciales (Client ID + secret + dominio) de UNA app a la vez. Esa
// app queda "armada" en la base hasta que una tienda se conecta con ella; recién
// ahí se libera el cupo y se puede cargar otra. Se guarda en kv_store (service
// key, RLS deny-all) — mismo nivel de protección que los accessToken de las tiendas.
// Reemplaza la dependencia de las env CRIPTOBLUE_SHOPIFY_* (que exigían redeploy).
// ─────────────────────────────────────────────────────────────────────────────

const KEY = () => kvKey('shopify-armed')

export interface ArmedShopifyApp {
  clientId: string
  clientSecret: string
  shop: string        // normalizado: <handle>.myshopify.com
  label: string
  armedAt: string
}

// "mitienda" o "mitienda.myshopify.com" → "mitienda.myshopify.com" (lowercase).
export function normalizeShopDomain(shop: string): string {
  const s = (shop || '').trim().toLowerCase()
  if (!s) return ''
  return s.includes('.myshopify.com') ? s : `${s}.myshopify.com`
}

export async function getArmedShopifyApp(): Promise<ArmedShopifyApp | null> {
  const { data, error } = await getClient().from('kv_store').select('value').eq('key', KEY()).maybeSingle()
  if (error) throw new Error(`getArmedShopifyApp falló: ${error.message} [${error.code}]`)
  const v = data?.value as ArmedShopifyApp | undefined
  if (!v || !v.clientId) return null
  return v
}

export async function setArmedShopifyApp(app: Omit<ArmedShopifyApp, 'armedAt'>): Promise<ArmedShopifyApp> {
  const value: ArmedShopifyApp = { ...app, shop: normalizeShopDomain(app.shop), armedAt: new Date().toISOString() }
  const { error } = await getClient()
    .from('kv_store')
    .upsert({ key: KEY(), value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`setArmedShopifyApp falló: ${error.message} [${error.code}]`)
  return value
}

export async function clearArmedShopifyApp(): Promise<void> {
  const { error } = await getClient().from('kv_store').delete().eq('key', KEY())
  if (error) throw new Error(`clearArmedShopifyApp falló: ${error.message} [${error.code}]`)
}

// Credenciales a usar para conectar un shop dado: la app armada si su dominio
// coincide, sino las de la env (compat con setups previos a esta feature).
export async function getShopifyCredsForShop(
  shop: string,
): Promise<{ clientId: string; clientSecret: string; fromArmed: boolean }> {
  const armed = await getArmedShopifyApp()
  if (armed && normalizeShopDomain(armed.shop) === normalizeShopDomain(shop)) {
    return { clientId: armed.clientId, clientSecret: armed.clientSecret, fromArmed: true }
  }
  return { clientId: CONFIG.shopify.clientId, clientSecret: CONFIG.shopify.clientSecret, fromArmed: false }
}
