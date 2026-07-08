'use client'

import { createBrowserClient } from '@supabase/ssr'

// Cliente Supabase para componentes de cliente (login, MFA, logout).
// Usa la anon key: la autorización real vive en app_users (server) y el middleware.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
