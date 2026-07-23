// Unidades de negocio, para los scripts de consola.
// MANTENER EN SYNC con lib/unidad.ts (los scripts no pueden importar TypeScript).

export const UNIDADES = {
  criptoblue: {
    id: 'criptoblue',
    nombre: 'CriptoBlue',
    rol: 'superadmin-criptoblue',
    kvPrefix: 'criptoblue',
    wallets: ['MF', 'Lacar', 'MS', 'Montemar', 'Copter MS', 'Otras'],
  },
  ms: {
    id: 'ms',
    nombre: 'MS',
    rol: 'superadmin-ms',
    kvPrefix: 'ms',
    wallets: [],
  },
}

export const UNIDAD_DEFAULT = 'criptoblue'
export const IDS = Object.keys(UNIDADES)

// 'superadmin-ms' → 'ms'.  null si no es un rol de super admin.
export function unidadDeRol(rol) {
  const hit = IDS.find(id => UNIDADES[id].rol === String(rol || '').toLowerCase())
  return hit ?? null
}

export function parseUnidad(v) {
  const s = String(v || '').toLowerCase()
  return IDS.includes(s) ? s : UNIDAD_DEFAULT
}

export function kvKey(unidad, nombre) {
  return `${UNIDADES[parseUnidad(unidad)].kvPrefix}:${nombre}`
}

// Directorio de tiendas de una unidad.
export async function getStores(supabase, unidad) {
  const { data } = await supabase.from('kv_store').select('value').eq('key', kvKey(unidad, 'stores')).maybeSingle()
  return data?.value ?? {}
}

// Busca un storeId en TODAS las unidades. Devuelve { unidad, store } o null.
export async function buscarTienda(supabase, storeId) {
  for (const id of IDS) {
    const stores = await getStores(supabase, id)
    if (stores[storeId]) return { unidad: id, store: stores[storeId] }
  }
  return null
}

// Lista, para los mensajes de error, todas las tiendas de todas las unidades.
export async function listarTiendas(supabase) {
  const out = []
  for (const id of IDS) {
    for (const [sid, st] of Object.entries(await getStores(supabase, id))) {
      out.push(`  ${sid} → ${st.storeName}  [${UNIDADES[id].nombre}]`)
    }
  }
  return out
}
