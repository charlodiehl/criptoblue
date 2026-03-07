import { NextResponse } from 'next/server'
import { saveStores, getStores } from '@/lib/storage'

const STORES = {
  '91039': {
    storeId: '91039',
    storeName: 'Jane Jones',
    accessToken: 'f5014823560e13c461d0ac3c6dde08a03cfe3f7c',
    connectedAt: '2025-05-27T20:13:17.441Z',
  },
  '1133924': {
    storeId: '1133924',
    storeName: 'Casa Perfecta',
    accessToken: '5c11b6c198913a5d6f8eb00d3488b4d262ec53ee',
    connectedAt: '2025-06-14T22:28:37.862Z',
  },
  '1935431': {
    storeId: '1935431',
    storeName: 'Desate',
    accessToken: 'ad45329b955355883a90256f7bfe7814128e4698',
    connectedAt: '2025-06-14T22:33:49.782Z',
  },
  '6557652': {
    storeId: '6557652',
    storeName: 'DeportivoShop',
    accessToken: 'f977f408f9d21d177a789000dce8597c9e4f6ba6',
    connectedAt: '2025-06-14T22:36:53.272Z',
  },
}

export async function POST() {
  try {
    await saveStores(STORES)
    return NextResponse.json({ success: true, stores: Object.keys(STORES) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const existing = await getStores()
    return NextResponse.json({ stores: existing })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
