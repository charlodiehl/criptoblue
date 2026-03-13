import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = '27051'
  const scope = 'write_orders read_orders'

  // TiendaNube OAuth: el app_id va en la ruta, no como query param
  const url = new URL(`https://www.tiendanube.com/apps/${clientId}/authorize`)
  url.searchParams.set('scope', scope)

  return NextResponse.redirect(url.toString())
}
