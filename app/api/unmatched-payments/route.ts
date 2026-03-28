import { NextResponse } from 'next/server'
import { loadHotState } from '@/lib/storage'

export async function GET() {
  try {
    const hot = await loadHotState()
    return NextResponse.json(hot.unmatchedPayments)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
