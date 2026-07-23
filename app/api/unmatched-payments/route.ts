import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'
import { requireUnidad, setUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesion (el middleware ya valido rol + 2FA).
  const sesion = await requireUnidad()
  if ('error' in sesion) return sesion.error
  setUnidad(sesion.unidad)
  try {
    const hot = await loadHotState()
    return NextResponse.json(hot.unmatchedPayments)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
