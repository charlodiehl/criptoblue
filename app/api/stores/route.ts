import { NextRequest, NextResponse } from 'next/server'
import { getStores, saveStores } from '@/lib/storage'

export async function GET() {
  try {
    const stores = await getStores()
    return NextResponse.json(Object.values(stores))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { storeId } = await req.json()
    if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

    const stores = await getStores()
    if (!stores[storeId]) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    delete stores[storeId]
    await saveStores(stores)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
