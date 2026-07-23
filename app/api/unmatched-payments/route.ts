import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'
import { requireUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const hot = await loadHotState()
    return NextResponse.json(hot.unmatchedPayments)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
