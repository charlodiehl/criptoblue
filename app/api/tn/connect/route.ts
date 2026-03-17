import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const clientId = '27051'
  const scope = 'write_orders read_orders'

  // Nombre de tienda ingresado por el usuario — se pasa como "state" al OAuth
  // TiendaNube devuelve el state intacto en el callback, sin necesidad de sesión
  const name = req.nextUrl.searchParams.get('name') || ''

  const url = new URL(`https://www.tiendanube.com/apps/${clientId}/authorize`)
  url.searchParams.set('scope', scope)
  if (name) url.searchParams.set('state', name)

  return NextResponse.redirect(url.toString())
}
