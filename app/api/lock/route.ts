import { NextResponse } from 'next/server'
import { getLockState } from '@/lib/storage'

export async function GET() {
  try {
    const lock = await getLockState()
    return NextResponse.json({ locked: !!lock, lock })
  } catch (err) {
    return NextResponse.json({ locked: false, error: String(err) }, { status: 500 })
  }
}
