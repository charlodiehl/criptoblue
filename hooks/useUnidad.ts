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
