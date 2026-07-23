'use client'
import { useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

// Mapeo de key de Supabase → qué funciones de fetch ejecutar.
// Las keys vienen prefijadas por unidad de negocio ('criptoblue:state' / 'ms:state'),
// así que se matchea por SUFIJO: el refetch que dispara cada handler pide los datos a
// la API, que ya los acota a la unidad de la sesión. Si cambia la key de la OTRA
// unidad, el único costo es un refetch de más — nunca se mezclan datos.
type FetchMap = {
  onHotChange: () => void    // <unidad>:state
  onLogsChange: () => void   // <unidad>:logs
  onOrdersChange: () => void // <unidad>:orders-cache
  onStoresChange: () => void // <unidad>:stores
}

export function useRealtimeSync(handlers: FetchMap) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    if (!supabase) {
      console.warn('[realtime] Supabase browser client no disponible — Realtime desactivado')
      return
    }

    const channel = supabase
      .channel('kv-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kv_notifications',
        },
        (payload) => {
          const key = (payload.new as { key: string })?.key
          if (!key) return

          console.log(`[realtime] Cambio detectado en key: ${key}`)

          if (key.endsWith(':state')) handlersRef.current.onHotChange()
          else if (key.endsWith(':logs')) handlersRef.current.onLogsChange()
          else if (key.endsWith(':orders-cache')) handlersRef.current.onOrdersChange()
          else if (key.endsWith(':stores')) handlersRef.current.onStoresChange()
          // <unidad>:processed no tiene UI directa
        }
      )
      .subscribe((status) => {
        console.log(`[realtime] Subscription status: ${status}`)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
}
