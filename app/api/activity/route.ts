import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

// GET → devuelve el activity log de las últimas 24hs ordenado desc (más reciente primero)
// Uso interno: consultar desde Claude para auditar acciones humanas y del sistema
export async function GET() {
  try {
    const state = await loadState()
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const entries = (state.activityLog || [])
      .filter(e => e.timestamp >= cutoff)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return NextResponse.json(entries)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
