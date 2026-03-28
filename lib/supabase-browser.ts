import { createClient } from '@supabase/supabase-js'

// Cliente Supabase para el browser — usa la anon key (pública, segura para el frontend)
// Se usa exclusivamente para Realtime (escuchar cambios en kv_store)
let _browserClient: ReturnType<typeof createClient> | null = null

export function getSupabaseBrowser() {
  if (_browserClient) return _browserClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  _browserClient = createClient(url, key)
  return _browserClient
}
