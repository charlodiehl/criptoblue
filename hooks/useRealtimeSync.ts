'use client'
import { useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

// Mapeo de key de Supabase → qué funciones de fetch ejecutar
type FetchMap = {
  onHotChange: () => void    // criptoblue:state
  onLogsChange: () => void   // criptoblue:logs
  onOrdersChange: () => void // criptoblue:orders-cache
  onStoresChange: () => void // criptoblue:stores
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

          switch (key) {
            case 'criptoblue:state':
              handlersRef.current.onHotChange()
              break
            case 'criptoblue:logs':
              handlersRef.current.onLogsChange()
              break
            case 'criptoblue:orders-cache':
              handlersRef.current.onOrdersChange()
              break
            case 'criptoblue:stores':
              handlersRef.current.onStoresChange()
              break
            // criptoblue:processed y criptoblue:match-log no tienen UI directa
          }
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
