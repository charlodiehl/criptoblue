import { NextRequest, NextResponse } from 'next/server'

// TiendaNube redirige a /callback — reenviamos a /api/tn/callback con todos los params
export async function GET(req: NextRequest) {
  const params = req.nextUrl.search // incluye "?code=..."
  return NextResponse.redirect(new URL(`/api/tn/callback${params}`, req.nextUrl.origin))
}
