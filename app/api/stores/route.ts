import { NextRequest, NextResponse } from 'next/server'
import { getStores, saveStores, loadState, saveState } from '@/lib/storage'
import { CONFIG } from '@/lib/config'

async function fetchStoreName(storeId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${CONFIG.tiendanube.apiBase}/${storeId}`, {
      headers: {
        Authentication: `bearer ${accessToken}`,
        'User-Agent': CONFIG.tiendanube.userAgent,
      },
    })
    if (!res.ok) {
      console.error(`[stores] fetchStoreName ${storeId} → HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    // TN puede devolver el nombre como string, objeto multilingual, o en business_name
    const name = data.name
    if (typeof name === 'string' && name) return name
    if (name && typeof name === 'object') {
      const fromName = name.es || name.pt || Object.values(name).find((v): v is string => typeof v === 'string') || null
      if (fromName) return fromName
    }
    if (typeof data.business_name === 'string' && data.business_name) return data.business_name
    console.error(`[stores] fetchStoreName ${storeId} → no name field found, data keys:`, Object.keys(data))
    return null
  } catch (err) {
    console.error(`[stores] fetchStoreName ${storeId} → exception:`, err)
    return null
  }
}

export async function GET() {
  try {
    const stores = await getStores()
    return NextResponse.json(Object.values(stores))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { storeId, storeName } = await req.json()
    if (!storeId || !storeName) return NextResponse.json({ error: 'storeId and storeName required' }, { status: 400 })

    const stores = await getStores()
    if (!stores[storeId]) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    stores[storeId].storeName = storeName
    await saveStores(stores)
    return NextResponse.json({ success: true })
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

    // Clean up all state records associated with this store
    const state = await loadState()
    state.pendingMatches = state.pendingMatches.filter(m => m.order?.storeId !== storeId)
    state.unmatchedPayments = state.unmatchedPayments.filter(p => (p as any).storeId !== storeId)
    await saveState(state)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
