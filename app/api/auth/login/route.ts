import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/auth/server'

// El login con usuario/contraseña fue reemplazado por Google OAuth (Supabase Auth).
// Queda solo el logout (DELETE) — lo llama el botón "Cerrar sesión" del header.
export async function DELETE() {
  const supabase = await createSupabaseServer()
  await supabase.auth.signOut()

  const res = NextResponse.json({ ok: true })
  // Limpia también la cookie de sesión del sistema viejo, si quedó.
  res.cookies.set('cb_session', '', { httpOnly: true, maxAge: 0, path: '/' })
  return res
}
