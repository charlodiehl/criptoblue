import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { parseUnidad } from '@/lib/unidad'

export async function GET(req: NextRequest) {
  const clientId = CONFIG.tiendanube.clientId
  const scope = 'write_orders read_orders'

  // Nombre de tienda elegido por el usuario — se empaqueta en "state" para el OAuth.
  // TiendaNube devuelve el state intacto en el callback, sin necesidad de sesión.
  // (Las tiendas ya no se vinculan a una billetera.)
  const name = req.nextUrl.searchParams.get('name') || ''

  // Unidad de negocio a la que va a quedar la tienda. Viaja por el state porque el
  // callback vuelve SIN sesión: es la única forma de saber de quién es la tienda.
  // Sin el parámetro, cae en la unidad original (criptoblue).
  const unidad = parseUnidad(req.nextUrl.searchParams.get('unidad'))

  const url = new URL(`https://www.tiendanube.com/apps/${clientId}/authorize`)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', JSON.stringify({ name, unidad }))

  return NextResponse.redirect(url.toString())
}
