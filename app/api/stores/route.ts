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
    if (!res.ok) return null
    const data = await res.json()
    const name = data.name
    if (typeof name === 'string') return name
    if (name && typeof name === 'object') {
      return name.es || name.pt || Object.values(name).find((v): v is string => typeof v === 'string') || null
    }
    return null
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const stores = await getStores()
    // Refresh names for stores that have fallback names (e.g. "Tienda 5512981")
    let updated = false
    for (const store of Object.values(stores)) {
      if (store.storeName.startsWith('Tienda ') && store.accessToken) {
        const name = await fetchStoreName(store.storeId, store.accessToken)
        if (name) {
          store.storeName = name
          updated = true
        }
      }
    }
    if (updated) await saveStores(stores)
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
