/**
 * cuit-lookup.ts — Lookup de nombre por CUIT usando cuitonline.com
 *
 * Consulta el meta description de cuitonline para obtener el nombre
 * del contribuyente asociado a un CUIT argentino.
 *
 * Retorna null si no se encuentra o si hay un error de red.
 * Retorna "~" como sentinel si el CUIT no está en cuitonline
 * (para evitar reintentar en ciclos futuros).
 */

const CUIT_LOOKUP_TIMEOUT_MS = 5000

function capitalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function lookupNombreByCuit(cuit: string): Promise<string | null> {
  if (!cuit || cuit.length !== 11) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CUIT_LOOKUP_TIMEOUT_MS)

    const res = await fetch(`https://www.cuitonline.com/search.php?q=${cuit}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) return null

    const html = await res.text()

    // Extraer del meta description: "... nombre apellido - 20XXXXXXXXX; "
    const metaMatch = html.match(/<meta name="description" content="([^"]+)"/)
    if (!metaMatch) return null

    const desc = metaMatch[1]
    const nameMatch = desc.match(/([A-Za-záéíóúÁÉÍÓÚüÜñÑ'\s]+)\s*-\s*\d{11}/)
    if (!nameMatch) return '~' // CUIT consultado pero no encontrado

    const nombre = nameMatch[1].trim()
    if (!nombre) return '~'

    return capitalizarNombre(nombre)
  } catch {
    return null // Error de red — se puede reintentar en el próximo ciclo
  }
}
