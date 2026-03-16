import { NextRequest, NextResponse } from 'next/server'
import { loadState, saveState } from '@/lib/storage'

// GET → lista todos los errores ordenados por timestamp desc
export async function GET() {
  try {
    const state = await loadState()
    const sorted = (state.errorLog || []).slice().sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    return NextResponse.json(sorted)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH → marcar un error como resuelto/no resuelto
// body: { id: string, resolved: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const { id, resolved } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const state = await loadState()
    const entry = (state.errorLog || []).find(e => e.id === id)
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entry.resolved = !!resolved
    await saveState(state)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE → eliminar todos los errores resueltos
export async function DELETE() {
  try {
    const state = await loadState()
    const before = (state.errorLog || []).length
    state.errorLog = (state.errorLog || []).filter(e => !e.resolved)
    const removed = before - state.errorLog.length
    await saveState(state)
    return NextResponse.json({ success: true, removed })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
