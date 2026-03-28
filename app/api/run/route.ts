import { NextResponse } from 'next/server'
import { processMPPayments } from '@/lib/cycle'

export const maxDuration = 60

// Auth manejada por middleware.ts — GET requiere CRON_SECRET, POST requiere sesión

export async function GET() {
  try {
    const result = await processMPPayments()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  try {
    const result = await processMPPayments()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
