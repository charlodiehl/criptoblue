// ─────────────────────────────────────────────────────────────
// Parser de comprobantes de transferencia/pago (texto crudo de OCR).
// Extrae { nombrePagador, monto, fechaISO } del texto que devuelve
// Tesseract sobre la imagen del comprobante.
//
// Diseño: reglas GENÉRICAS que cubren la mayoría de los comprobantes
// (MercadoPago, apps de bancos argentinos). Si algún banco específico
// no se lee bien, se agrega un "perfil" en BANK_PROFILES con sus
// keywords/labels propios — el parser prueba primero los perfiles que
// matchean y cae al genérico si ninguno aplica.
// ─────────────────────────────────────────────────────────────

export interface ComprobanteParse {
  nombrePagador: string
  monto: number | null
  fechaISO: string | null   // ISO 8601 con offset -03:00 (ART) si se detectó hora
  // Diagnóstico opcional para depurar lecturas
  _debug?: {
    bankProfile: string | null
    montoRaw: string | null
    fechaRaw: string | null
    nombreRaw: string | null
  }
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

// Normaliza el texto: minúsculas para matching, sin acentos, espacios colapsados.
function normalizar(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // quita acentos
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase()
}

// ── Monto ──────────────────────────────────────────────────────
// Convierte "55.920,00" / "$ 55.920" / "1.234.567,89" → número.
function parsearMontoTexto(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, '')
  if (!s) return null
  // Formato AR: punto = miles, coma = decimal.
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Sin coma: los puntos son separadores de miles (ej "55.920").
    // Salvo que haya un único punto con 1-2 dígitos detrás (ej "55920.00").
    const m = s.match(/\.(\d{1,2})$/)
    if (m && (s.match(/\./g) || []).length === 1) {
      // "55920.00" → decimal
    } else {
      s = s.replace(/\./g, '')
    }
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// Busca el monto. Prioriza valores cerca de keywords de importe; si no,
// toma el mayor monto con símbolo $ del texto.
function extraerMonto(texto: string, norm: string): { monto: number | null; raw: string | null } {
  const LABELS = ['importe', 'monto', 'total', 'transferiste', 'enviaste', 'pagaste', 'valor']
  const lineas = texto.split('\n')
  const lineasNorm = norm.split('\n')

  // Patrón de "corrida de número": dígitos con separadores de miles/decimal.
  // Captura completo "55.920,00", "1234.50", "3.596.753,09". parsearMontoTexto interpreta.
  // Importante: usar [., ] (no \s) para que NO cruce saltos de línea y se "pegue"
  // al número de la línea siguiente (ej. una fecha).
  const NUM_CON_PESO = /\$[ \t]*\d+(?:[., ]\d+)*/
  const NUM_SUELTO = /\d+(?:[., ]\d+)*/

  // 1) Línea con label de importe → primer monto en esa línea (o la siguiente)
  for (let i = 0; i < lineasNorm.length; i++) {
    if (LABELS.some(l => lineasNorm[i].includes(l))) {
      for (const cand of [lineas[i], lineas[i + 1] ?? '']) {
        // Evitar capturar fechas (dd/mm/aaaa) como monto: las descartamos
        const sinFechas = cand.replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g, ' ')
        const m = sinFechas.match(NUM_CON_PESO) || sinFechas.match(NUM_SUELTO)
        if (m) {
          const val = parsearMontoTexto(m[0])
          if (val && val > 0) return { monto: val, raw: m[0].trim() }
        }
      }
    }
  }

  // 2) Fallback: todos los montos con $ → el mayor (suele ser el importe principal)
  const candidatos: { val: number; raw: string }[] = []
  const re = /\$[ \t]*\d+(?:[., ]\d+)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    const val = parsearMontoTexto(m[0])
    if (val && val > 0) candidatos.push({ val, raw: m[0].trim() })
  }
  if (candidatos.length) {
    candidatos.sort((a, b) => b.val - a.val)
    return { monto: candidatos[0].val, raw: candidatos[0].raw }
  }

  // 3) Fallback sin "$": el OCR suele NO leer el símbolo $ (lo lee como S, 5 o nada).
  // Buscar números con formato de miles argentino (X.XXX o X.XXX,XX). Este formato
  // distingue un monto de un CUIT ("27-24256770-1", con guiones) y de un CVU o número
  // de operación ("0000003100068240675664", "164070234934", corridas sin puntos).
  // Primero se quitan fechas y CUITs para no capturarlos por error.
  const sinRuido = texto
    .replace(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g, ' ')  // fechas
    .replace(/\d{2}-\d{6,8}-\d/g, ' ')                       // CUIT/CUIL con guiones
  const reMiles = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?/g
  const milesCand: { val: number; raw: string }[] = []
  while ((m = reMiles.exec(sinRuido)) !== null) {
    const val = parsearMontoTexto(m[0])
    if (val && val > 0) milesCand.push({ val, raw: m[0].trim() })
  }
  if (milesCand.length) {
    milesCand.sort((a, b) => b.val - a.val)
    return { monto: milesCand[0].val, raw: milesCand[0].raw }
  }
  return { monto: null, raw: null }
}

// Busca fecha y (opcionalmente) hora. Devuelve ISO en horario AR.
function extraerFecha(texto: string, norm: string): { fechaISO: string | null; raw: string | null } {
  // Hora "22:39" o "22:39:41" (con o sin "hs")
  const horaMatch = norm.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/)
  let hh = 0, mm = 0, ss = 0, tieneHora = false
  if (horaMatch) {
    hh = parseInt(horaMatch[1], 10); mm = parseInt(horaMatch[2], 10)
    ss = horaMatch[3] ? parseInt(horaMatch[3], 10) : 0
    if (hh <= 23 && mm <= 59) tieneHora = true
  }

  // a) dd/mm/aaaa o dd-mm-aaaa o dd.mm.aaaa
  let dia = 0, mes = 0, anio = 0, raw: string | null = null
  const numMatch = norm.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/)
  if (numMatch) {
    dia = parseInt(numMatch[1], 10); mes = parseInt(numMatch[2], 10)
    anio = parseInt(numMatch[3], 10)
    if (anio < 100) anio += 2000
    raw = numMatch[0]
  } else {
    // b) "12 de mayo de 2026" o "12 mayo 2026"
    const txtMatch = norm.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})\b/)
    if (txtMatch && MESES[txtMatch[2]]) {
      dia = parseInt(txtMatch[1], 10); mes = MESES[txtMatch[2]]; anio = parseInt(txtMatch[3], 10)
      raw = txtMatch[0]
    }
  }

  if (!dia || !mes || !anio || dia > 31 || mes > 12) return { fechaISO: null, raw: null }

  const pad = (n: number) => String(n).padStart(2, '0')
  const fechaISO = tieneHora
    ? `${anio}-${pad(mes)}-${pad(dia)}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000-03:00`
    : `${anio}-${pad(mes)}-${pad(dia)}T00:00:00.000-03:00`
  const rawFull = tieneHora && horaMatch ? `${raw} ${horaMatch[0]}` : raw
  return { fechaISO, raw: rawFull }
}

// Busca el nombre del pagador cerca de labels conocidos. El label debe ser un
// TOKEN de la línea (la línea ES el label, o empieza con "label:" / "label "),
// no un substring suelto — así "de" no matchea dentro de "Comprobante de transferencia".
// Cuando el label está solo en su línea (ej. el bullet "• De" de MercadoPago), el
// nombre se toma de la línea SIGUIENTE.
function extraerNombre(texto: string, norm: string, labels: string[]): { nombre: string; raw: string | null } {
  // Quitar cualquier símbolo inicial (viñetas, guiones, espacios y basura del OCR
  // como "?", "*", "'", etc.) hasta el primer carácter alfanumérico. El OCR lee los
  // bullets "•" de formas impredecibles ("?", "*", "'"...), así que no podemos
  // listarlos uno por uno — quitamos todo lo que no sea letra/número del inicio.
  const quitarBullet = (s: string) => s.replace(/^[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '')
  const lineas = texto.split('\n').map(quitarBullet)
  const lineasNorm = norm.split('\n').map(l => quitarBullet(l).trim())

  for (let i = 0; i < lineasNorm.length; i++) {
    const ln = lineasNorm[i]
    for (const label of labels) {
      // Caso A: la línea ES el label (ej. "de", "de:") → nombre en la línea siguiente
      if (ln === label || ln === label + ':') {
        const sig = limpiarNombre((lineas[i + 1] ?? '').trim())
        if (sig) return { nombre: sig, raw: lineas[i + 1] }
        continue
      }
      // Caso B: la línea empieza con "label:" o "label " + el nombre en la misma línea
      // (ej. "De: Maria Soledad"). El separador evita falsos positivos como "destinatario".
      if (ln.startsWith(label + ':') || ln.startsWith(label + ' ')) {
        const resto = lineas[i].slice(label.length).replace(/^[:\s]+/, '').trim()
        const limpio = limpiarNombre(resto)
        if (limpio) return { nombre: limpio, raw: resto }
      }
    }
  }
  return { nombre: '', raw: null }
}

// Palabras de "sistema" que aparecen en los comprobantes pero NO son nombres.
// Si el candidato está compuesto SOLO por estas, se descarta.
const PALABRAS_SISTEMA = new Set([
  'transferencia', 'comprobante', 'mercado', 'pago', 'mercadopago', 'motivo',
  'varios', 'cvu', 'cbu', 'cuit', 'cuil', 'alias', 'banco', 'cuenta', 'caja',
  'ahorro', 'operacion', 'operación', 'numero', 'número', 'de', 'para', 'dni',
  'importe', 'monto', 'total', 'fecha', 'hora', 'destino', 'origen', 'titular',
])

// Limpia un candidato a nombre: descarta si tiene dígitos largos (CBU/CUIT),
// símbolos de dinero, palabras de sistema, o es demasiado corto. Capitaliza.
function limpiarNombre(s: string): string {
  if (!s) return ''
  const t = s.replace(/\s+/g, ' ').trim()
  if (/\d{6,}/.test(t)) return ''         // CBU/CUIT/cuenta
  if (/[$%@]/.test(t)) return ''
  // Solo letras, espacios, puntos, guiones (nombres). Permite tildes/ñ.
  const soloNombre = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ.\s-]/g, '').trim()
  const palabras = soloNombre.split(/\s+/).filter(w => w.length >= 2)
  if (palabras.length < 1) return ''
  if (soloNombre.length < 3 || soloNombre.length > 60) return ''
  // Descartar si TODAS las palabras son de sistema (ej. "Transferencia", "Mercado Pago")
  const sinAcentos = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (palabras.every(w => PALABRAS_SISTEMA.has(sinAcentos(w.toLowerCase())))) return ''
  return palabras
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// ── Perfiles de banco (extensible) ─────────────────────────────
// Cada perfil declara cómo reconocerse (matchKeywords) y qué labels
// usar para el nombre. Si un banco lee mal con el genérico, se agrega
// acá un perfil con sus labels específicos.
interface BankProfile {
  name: string
  matchKeywords: string[]        // si el texto contiene alguno → aplica el perfil
  nombreLabels: string[]         // labels para ubicar el nombre del pagador/destinatario
}

const BANK_PROFILES: BankProfile[] = [
  {
    name: 'mercadopago',
    matchKeywords: ['mercado pago', 'mercadopago', 'cvu', 'dinero en cuenta'],
    // Queremos el NOMBRE DEL PAGADOR = el bloque "De" (quien envió la transferencia).
    // NO "Para" (ese es el destinatario = la tienda). En MP el nombre va en la
    // línea siguiente al bullet "• De".
    nombreLabels: ['de', 'origen', 'titular', 'desde'],
  },
  // Agregar perfiles específicos acá a medida que aparezcan bancos que fallen.
]

// Labels genéricos para el nombre del PAGADOR (fallback). Se priorizan labels de
// origen; se evitan los de destinatario (para/destinatario/beneficiario) porque
// esos identifican a la tienda, no al pagador.
const NOMBRE_LABELS_GENERICOS = [
  'de', 'origen', 'titular', 'desde', 'pagador', 'enviado por', 'a nombre de', 'nombre',
]

export function parseComprobante(textoOCR: string): ComprobanteParse {
  const texto = textoOCR || ''
  const norm = normalizar(texto)

  // Detectar perfil de banco
  const profile = BANK_PROFILES.find(p => p.matchKeywords.some(k => norm.includes(k))) ?? null
  const nombreLabels = profile ? profile.nombreLabels : NOMBRE_LABELS_GENERICOS

  const { monto, raw: montoRaw } = extraerMonto(texto, norm)
  const { fechaISO, raw: fechaRaw } = extraerFecha(texto, norm)
  const { nombre, raw: nombreRaw } = extraerNombre(texto, norm, nombreLabels)

  return {
    nombrePagador: nombre,
    monto,
    fechaISO,
    _debug: {
      bankProfile: profile?.name ?? null,
      montoRaw, fechaRaw, nombreRaw,
    },
  }
}

// Exportadas para testeo unitario directo.
export const _internals = { parsearMontoTexto, extraerMonto, extraerFecha, extraerNombre, limpiarNombre, normalizar }
