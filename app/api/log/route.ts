import { NextResponse } from 'next/server'
import { loadState, saveState } from '@/lib/storage'

// GET: devuelve matchLog + recentMatches para el frontend
export async function GET() {
  try {
    const state = await loadState()
    return NextResponse.json({
      entries: state.matchLog,
      recentMatches: state.recentMatches || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE: borra el registro manualmente (no toca recentMatches ni pagos)
export async function DELETE() {
  try {
    const state = await loadState()
    state.matchLog = []
    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
