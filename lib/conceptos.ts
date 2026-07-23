import { kvGet, kvSet } from './storage'
import { kvKey } from './unidad'

// ─────────────────────────────────────────────────────────────────────────────
// Conceptos por tienda (etiquetas de transferencias / reclamos / saldo personalizado).
// Lista LRU de máximo 10, por tienda, en kv_store: <unidad>:conceptos:<storeId>.
// Aislada por tienda: cada integrante ve solo los de la suya.
// ─────────────────────────────────────────────────────────────────────────────

const MAX = 10
const LARGO_MAX = 40
const key = (storeId: string) => kvKey(`conceptos:${storeId}`)

export async function getConceptos(storeId: string): Promise<string[]> {
  const list = await kvGet<string[]>(key(storeId))
  return Array.isArray(list) ? list.filter(x => typeof x === 'string' && x.trim()) : []
}

// Sanea un concepto tal cual lo va a ver la app (recorta y limita el largo).
export function sanearConcepto(nombre: string | null | undefined): string {
  return (nombre || '').replace(/\s+/g, ' ').trim().slice(0, LARGO_MAX)
}

// Agrega o "renueva" un concepto en la lista de la tienda: lo pone al FRENTE (LRU),
// deduplica sin distinguir mayúsculas, y recorta a los 10 más recientes. Sirve tanto
// para crear uno nuevo como para "tocar" uno existente cuando se vuelve a usar.
// Devuelve la lista resultante. Si el nombre queda vacío, no toca nada.
export async function usarConcepto(storeId: string, nombre: string): Promise<string[]> {
  const limpio = sanearConcepto(nombre)
  if (!limpio) return getConceptos(storeId)
  const actual = await getConceptos(storeId)
  const sinDup = actual.filter(c => c.toLowerCase() !== limpio.toLowerCase())
  const nueva = [limpio, ...sinDup].slice(0, MAX)
  await kvSet(key(storeId), nueva)
  return nueva
}
