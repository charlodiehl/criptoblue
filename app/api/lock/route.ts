import { NextResponse } from 'next/server'
import { getLockState } from '@/lib/storage'
import { requireUnidad, setUnidad } from '@/lib/auth/server'

export async function GET() {
  // La unidad de negocio sale de la sesion (el middleware ya valido rol + 2FA).
  const sesion = await requireUnidad()
  if ('error' in sesion) return sesion.error
  setUnidad(sesion.unidad)
  try {
    const lock = await getLockState()
    return NextResponse.json({ locked: !!lock, lock })
  } catch (err) {
    return NextResponse.json({ locked: false, error: String(err) }, { status: 500 })
  }
}
