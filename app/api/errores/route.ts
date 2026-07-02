import { NextResponse } from 'next/server'
import { loadLogs, saveLogs } from '@/lib/storage'
import type { ErrorEntry } from '@/lib/types'

// Centro de errores del header (campana). Lee/marca el errorLog de criptoblue:logs.
// Auth por sesión (proxy.ts) — lo consume el humano logueado, no un servicio externo.

// Solo 'error' llega a la campana. Los 'warning' (ej. fetch fallido de una tienda)
// son recurrentes y ruidosos: quedan en el errorLog para debugging pero no alertan.
// Un pago que no se carga siempre se registra como 'error'.
function esAlerta(e: ErrorEntry): boolean {
  return e.level === 'error'
}

// GET → { errores: [...max 50, más reciente primero], noVistos: N }
export async function GET() {
  try {
    const logs = await loadLogs()
    const alertas = (logs.errorLog ?? [])
      .filter(esAlerta)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const noVistos = alertas.filter(e => e.seen !== true).length
    return NextResponse.json({ errores: alertas.slice(0, 50), noVistos })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST { action: 'marcar_vistos' } → marca todas las alertas como vistas (baja el badge a 0)
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    if (body.action !== 'marcar_vistos') {
      return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
    }

    const logs = await loadLogs()
    let cambiados = 0
    for (const e of logs.errorLog ?? []) {
      if (esAlerta(e) && e.seen !== true) {
        e.seen = true
        cambiados++
      }
    }
    if (cambiados > 0) await saveLogs(logs)

    return NextResponse.json({ success: true, marcados: cambiados })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
