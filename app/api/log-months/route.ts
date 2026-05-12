import { NextResponse } from 'next/server'
import { getAvailableLogMonths, getCurrentLogMonthKey } from '@/lib/storage'

export async function GET() {
  try {
    const [months, currentMonth] = await Promise.all([
      getAvailableLogMonths(),
      Promise.resolve(getCurrentLogMonthKey()),
    ])
    return NextResponse.json({ months, currentMonth })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
