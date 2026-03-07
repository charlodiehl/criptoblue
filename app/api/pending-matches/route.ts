import { NextResponse } from 'next/server'
import { loadState } from '@/lib/storage'

export async function GET() {
  try {
    const state = await loadState()
    return NextResponse.json(state.pendingMatches)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
