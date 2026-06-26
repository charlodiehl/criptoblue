/**
 * Fiwind → CriptoBlue
 * ────────────────────────────────────────────────────────────────────────────
 * Lee los emails de notificación de Fiwind que llegan a la casilla Gmail,
 * extrae los datos de la transferencia y los envía al webhook de CriptoBlue.
 *
 * Corre dentro de Google Apps Script (script.google.com) con la cuenta
 * comprobantespagosblue@gmail.com. Se dispara con un trigger por tiempo.
 *
 * INSTALACIÓN: ver README.md de esta carpeta.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  // URL del endpoint de CriptoBlue (producción).
  WEBHOOK_URL: 'https://criptoblue.vercel.app/api/fiwind/webhook',

  // Secreto compartido. DEBE coincidir con la env var FIWIND_WEBHOOK_SECRET
  // configurada en Vercel. Cambiar por el valor real antes de usar.
  WEBHOOK_SECRET: 'CAMBIAR_POR_EL_SECRETO',

  // Query de Gmail para encontrar los emails de Fiwind sin procesar.
  // El reenvío conserva el remitente original no-reply@fiwind.io (igual que en
  // los emails anteriores), así que filtramos directo por "from".
  SEARCH_QUERY: 'from:no-reply@fiwind.io -label:fiwind-procesado',

  // Etiqueta que se aplica a cada hilo ya enviado, para no repetirlo.
  LABEL_PROCESADO: 'fiwind-procesado',

  // Etiqueta opcional para hilos que matchearon pero no se pudieron parsear.
  LABEL_REVISAR: 'fiwind-revisar',

  // Máximo de hilos por corrida (evita timeouts en lotes grandes).
  MAX_THREADS: 25,
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal — la que dispara el trigger.
// ─────────────────────────────────────────────────────────────────────────────
function procesarEmailsFiwind() {
  const labelOk = obtenerOCrearLabel(CONFIG.LABEL_PROCESADO)
  const labelRevisar = obtenerOCrearLabel(CONFIG.LABEL_REVISAR)

  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.MAX_THREADS)
  Logger.log('Hilos encontrados: ' + threads.length)

  for (const thread of threads) {
    let algunoEnviado = false
    let algunoFallo = false

    for (const msg of thread.getMessages()) {
      // Fiwind manda los datos en una tabla HTML; el texto plano los pierde.
      // Por eso leemos el HTML (getBody) y lo pasamos a texto antes de parsear.
      const datos = parsearEmail(htmlAVexto(msg.getBody()))
      if (!datos) { algunoFallo = true; continue }

      const ok = enviarAlWebhook(datos, msg)
      if (ok) algunoEnviado = true
      else algunoFallo = true
    }

    // Si al menos uno se envió bien, marcamos el hilo como procesado.
    if (algunoEnviado) thread.addLabel(labelOk)
    // Si algo falló (no parseó o el webhook rechazó), lo dejamos para revisar.
    else if (algunoFallo) thread.addLabel(labelRevisar)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser del cuerpo del email
// ─────────────────────────────────────────────────────────────────────────────
function parsearEmail(body) {
  if (!body) return null

  // Solo procesamos DEPÓSITOS (pagos entrantes). Los retiros/envíos ("Enviaste")
  // se descartan acá → el hilo queda en 'fiwind-revisar' para revisión manual.
  const operacion = extraerCampo(body, 'Operación')
  if (!/dep[oó]sito/i.test(operacion)) return null

  const monto = extraerMonto(body)
  const fechaISO = extraerFecha(body)
  const nombre = normalizarTitular(extraerCampo(body, 'Titular'))
  const cbuCvu = extraerCampo(body, 'CBU/CVU').replace(/\s/g, '')
  const banco = extraerCampo(body, 'Banco')
  const idCoelsa = extraerCampo(body, 'ID COELSA').replace(/\s/g, '')

  // Sin monto o sin fecha no podemos emparejar: no es un email válido.
  if (!monto || !fechaISO) return null

  return { monto, fechaISO, nombre, cbuCvu, banco, idCoelsa, operacion, raw: body }
}

// "Monto: 116.977,51 ARS"  o  el monto suelto "116.977,51 ARS"
// Formato argentino: punto = miles, coma = decimales → 116977.51
function extraerMonto(body) {
  const m = body.match(/Monto:\s*([\d.]+,\d{2})/) || body.match(/([\d.]+,\d{2})\s*ARS/)
  if (!m) return null
  const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
  return isFinite(num) && num > 0 ? num : null
}

// "Fecha: 24-01-2026 14:36" (dd-mm-yyyy HH:MM) → ISO con offset Argentina (-03:00)
function extraerFecha(body) {
  const m = body.match(/Fecha:\s*(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/)
  if (!m) return null
  const dd = m[1], mm = m[2], yyyy = m[3], hh = m[4], min = m[5]
  return yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + min + ':00-03:00'
}

// "FACCIO, ROMINA" (Apellido, Nombre) → "ROMINA FACCIO"
function normalizarTitular(raw) {
  if (!raw) return ''
  const partes = raw.split(',').map(function (s) { return s.trim() }).filter(Boolean)
  if (partes.length === 2) return partes[1] + ' ' + partes[0]
  return raw.trim()
}

// Extrae el valor de una línea "Etiqueta: valor". Escapa la "/" del label.
function extraerCampo(body, label) {
  const safe = label.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')
  const m = body.match(new RegExp(safe + ':\\s*(.+)'))
  return m ? m[1].trim() : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío al webhook
// ─────────────────────────────────────────────────────────────────────────────
function enviarAlWebhook(datos, msg) {
  try {
    const resp = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        secret: CONFIG.WEBHOOK_SECRET,
        idCoelsa: datos.idCoelsa,   // identificador único de la transferencia
        monto: datos.monto,
        nombre: datos.nombre,
        fechaISO: datos.fechaISO,
        cbuCvu: datos.cbuCvu,
        banco: datos.banco,
        operacion: datos.operacion,
        raw: datos.raw,
        emailId: msg.getId(),
      }),
    })
    const code = resp.getResponseCode()
    if (code >= 200 && code < 300) return true
    Logger.log('Webhook respondió ' + code + ': ' + resp.getContentText())
    return false
  } catch (e) {
    Logger.log('Error al postear al webhook: ' + e)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
function obtenerOCrearLabel(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre)
}

// Convierte el HTML del email a texto, conservando los saltos entre celdas/filas
// para que queden los pares "Label: valor" que busca el parser.
function htmlAVexto(html) {
  if (!html) return ''
  let t = html
  t = t.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, '\n')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  t = t.replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)) })
  t = t.replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n')
  return t.trim()
}

// Crea (o recrea) el trigger por tiempo. Ejecutar UNA vez a mano tras instalar.
function crearTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesarEmailsFiwind') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('procesarEmailsFiwind').timeBased().everyMinutes(5).create()
  Logger.log('Trigger creado: cada 5 minutos.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Prueba local del parser con el email de ejemplo (no envía nada).
// Ejecutar a mano y mirar Ver → Registros.
// ─────────────────────────────────────────────────────────────────────────────
function _probarParser() {
  const ejemplo = [
    '116.977,51 ARS',
    'Depósito',
    'Fecha: 24-01-2026 14:36',
    'Operación: Depósito',
    'Monto: 116.977,51 ARS',
    'Titular: FACCIO, ROMINA',
    'CBU/CVU: 0340251308730018946006',
    'Banco: Banco Patagonia',
    'ID COELSA: 76V4MR2Z7D7PG8K9NDEZOL',
  ].join('\n')

  const datos = parsearEmail(ejemplo)
  Logger.log(JSON.stringify(datos, null, 2))
  // Esperado: monto=116977.51, fechaISO=2026-01-24T14:36:00-03:00,
  // nombre="ROMINA FACCIO", cbuCvu=0340..., banco="Banco Patagonia",
  // idCoelsa=76V4MR2Z7D7PG8K9NDEZOL
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico: toma el último email de Fiwind, muestra su cuerpo real, el
// resultado del parseo y la respuesta del webhook. Para depurar cuando un email
// queda en 'fiwind-revisar'. Ejecutar a mano y mirar el Registro de ejecución.
// ─────────────────────────────────────────────────────────────────────────────
function _diagnosticarUltimo() {
  const threads = GmailApp.search('from:no-reply@fiwind.io', 0, 1)
  if (!threads.length) { Logger.log('No hay emails de Fiwind'); return }
  const msgs = threads[0].getMessages()
  Logger.log('Mensajes en el hilo: ' + msgs.length)
  for (let i = 0; i < msgs.length; i++) {
    const body = htmlAVexto(msgs[i].getBody())
    Logger.log('===== MSG ' + (i + 1) + ' | from: ' + msgs[i].getFrom() + ' =====')
    Logger.log('TEXTO LIMPIO (1200 chars):\n' + body.slice(0, 1200))
    const datos = parsearEmail(body)
    Logger.log('PARSEO: ' + JSON.stringify(datos))
    if (datos) {
      const resp = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          secret: CONFIG.WEBHOOK_SECRET, idCoelsa: datos.idCoelsa, monto: datos.monto,
          nombre: datos.nombre, fechaISO: datos.fechaISO, cbuCvu: datos.cbuCvu,
          banco: datos.banco, operacion: datos.operacion, raw: datos.raw, emailId: msgs[i].getId(),
        }),
      })
      Logger.log('WEBHOOK: HTTP ' + resp.getResponseCode() + ' → ' + resp.getContentText())
    }
  }
}
