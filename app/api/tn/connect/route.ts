import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = '27051'
  const scope = 'write_orders read_orders'

  const url = new URL('https://www.tiendanube.com/apps/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)

  return NextResponse.redirect(url.toString())
}
