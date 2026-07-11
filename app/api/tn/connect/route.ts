import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const clientId = '27051'
  const scope = 'write_orders read_orders'

  // Nombre de tienda elegido por el usuario — se empaqueta en "state" para el OAuth.
  // TiendaNube devuelve el state intacto en el callback, sin necesidad de sesión.
  // (Las tiendas ya no se vinculan a una billetera.)
  const name = req.nextUrl.searchParams.get('name') || ''

  const url = new URL(`https://www.tiendanube.com/apps/${clientId}/authorize`)
  url.searchParams.set('scope', scope)
  if (name) {
    url.searchParams.set('state', JSON.stringify({ name }))
  }

  return NextResponse.redirect(url.toString())
}
