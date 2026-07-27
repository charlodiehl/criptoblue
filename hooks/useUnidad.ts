'use client'

import { useEffect, useState } from 'react'

// Unidad de negocio de la sesión, para el lado del cliente.
//
// Se pide UNA sola vez por carga de página y se comparte entre todos los
// componentes (la promesa queda cacheada a nivel de módulo): la usan varios
// selectores de billetera y no tiene sentido pegarle una vez por cada uno.

export interface UnidadInfo {
  id: string
  nombre: string
  rol: string
  wallets: string[]
  // ISO. Nada anterior a estas fechas pertenece a la unidad.
  cutoffs?: { pagos: string; ordenes: string; balance: string }
}

let cache: Promise<UnidadInfo | null> | null = null

function pedir(): Promise<UnidadInfo | null> {
  if (!cache) {
    cache = fetch('/api/mi-unidad')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return cache
}

export function useUnidad(): UnidadInfo | null {
  const [unidad, setUnidad] = useState<UnidadInfo | null>(null)
  useEffect(() => {
    let vivo = true
    pedir().then(u => { if (vivo) setUnidad(u) })
    return () => { vivo = false }
  }, [])
  return unidad
}

// Billeteras de la unidad. Array vacío mientras carga o si no hay ninguna
// conectada — nunca cae en la lista de otra unidad.
export function useWallets(): string[] {
  return useUnidad()?.wallets ?? []
}

// Cortes de la unidad en epoch ms. Mientras carga devuelve 0 (no filtra nada): el
// servidor ya acota lo que manda, así que un instante sin filtrar no muestra datos
// de otra unidad — a lo sumo, algo que enseguida desaparece.
export function useCutoffs(): { pagos: number; ordenes: number } {
  const u = useUnidad()
  const ms = (v?: string) => (v ? new Date(v).getTime() || 0 : 0)
  return { pagos: ms(u?.cutoffs?.pagos), ordenes: ms(u?.cutoffs?.ordenes) }
}
