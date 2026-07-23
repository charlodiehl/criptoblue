import { NextResponse } from 'next/server'
import { getRegistroMonths } from '@/lib/registro'
import { requireUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const months = await getRegistroMonths()
    const currentMonth = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
    return NextResponse.json({ months, currentMonth })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
