import { NextResponse } from 'next/server'
import { getLockState } from '@/lib/storage'
import { requireUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesión (el middleware ya validó rol + 2FA).
  const errUnidad = await requireUnidad()
  if (errUnidad) return errUnidad
  try {
    const lock = await getLockState()
    return NextResponse.json({ locked: !!lock, lock })
  } catch (err) {
    return NextResponse.json({ locked: false, error: String(err) }, { status: 500 })
  }
}
