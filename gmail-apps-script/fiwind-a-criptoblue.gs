/**
 * Fiwind → CriptoBlue
 * ────────────────────────────────────────────────────────────────────────────
 * Lee los emails de notificación de Fiwind que llegan a la casilla Gmail,
 * extrae los datos de la transferencia y los envía al webhook de CriptoBlue.
 *
 * Corre dentro de Google Apps Script (script.google.com). Se dispara con un
 * trigger por tiempo (cada 5 minutos).
 *
 * DEDUP POR MENSAJE (no por hilo): Gmail agrupa emails parecidos en un mismo
 * hilo. Si etiquetábamos el hilo entero como "procesado", un email nuevo que
 * caía en un hilo ya etiquetado quedaba excluido de la búsqueda y NUNCA se
 * procesaba. Ahora se lleva un registro de los IDs de MENSAJE ya enviados en
 * ScriptProperties, y se evalúa cada mensaje por separado.
 *
 * INSTALACIÓN: ver README.md de esta carpeta.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  // URL del endpoint de CriptoBlue (producción).
  WEBHOOK_URL: 'https://criptoblue.vercel.app/api/fiwind/webhook',

  // ⚠️⚠️ PEGÁ ACÁ TU SECRETO REAL ⚠️⚠️  (el mismo valor que FIWIND_WEBHOOK_SECRET en Vercel).
  //   Lo tenés en tu Apps Script ACTUAL (esta misma línea, antes de reemplazar el código),
  //   o en Vercel → Settings → Environment Variables → FIWIND_WEBHOOK_SECRET.
  WEBHOOK_SECRET: 'CAMBIAR_POR_EL_SECRETO',

  // Búsqueda: emails de Fiwind de los últimos N días. NO se filtra por etiqueta —
  // el dedup es por ID de mensaje (ver abajo). La ventana acota el volumen.
  SEARCH_QUERY: 'from:no-reply@fiwind.io newer_than:3d',

  // ── Etiquetas (CUSTOMIZABLES: cambiá los nombres a gusto) ─────────────────
  // Se aplica a los emails ya enviados a la app, para que lleves el seguimiento.
  // Es una etiqueta de HILO (Gmail no permite etiquetar mensajes sueltos), pero
  // el dedup real es por ID de mensaje, así que la etiqueta es solo informativa.
  LABEL_PROCESADO: 'fiwind-procesado',
  // Se aplica a los emails que no se pudieron parsear/enviar (revisión manual).
  LABEL_REVISAR: 'fiwind-revisar',

  // Máximo de hilos por corrida (evita timeouts). Se procesan del más nuevo al más viejo.
  MAX_THREADS: 80,

  // Clave en ScriptProperties donde se guardan los IDs de mensaje ya enviados.
  PROP_KEY: 'fiwind_msgids_enviados',
  // Cuántos IDs conservar (poda). Debe cubrir de sobra la ventana de búsqueda.
  MAX_IDS_GUARDADOS: 1500,
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal — la que dispara el trigger.
// ─────────────────────────────────────────────────────────────────────────────
function procesarEmailsFiwind() {
  const props = PropertiesService.getScriptProperties()
  const enviados = new Set(leerIdsEnviados(props))
  const labelProcesado = obtenerOCrearLabel(CONFIG.LABEL_PROCESADO)
  const labelRevisar = obtenerOCrearLabel(CONFIG.LABEL_REVISAR)

  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.MAX_THREADS)
  Logger.log('Hilos encontrados: ' + threads.length + ' | ya enviados en registro: ' + enviados.size)

  let nuevos = 0
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const msgId = msg.getId()
      // Dedup por MENSAJE: si este email ya se envió, lo salteamos sin importar el hilo.
      if (enviados.has(msgId)) continue

      // Fiwind manda los datos en una tabla HTML; el texto plano los pierde.
      const datos = parsearEmail(htmlAVexto(msg.getBody()))
      if (!datos) {
        // No es depósito o no parseó → a revisar. NO se marca como enviado
        // (por si es un depósito real que hay que corregir a mano).
        try { thread.addLabel(labelRevisar) } catch (e) {}
        continue
      }

      const ok = enviarAlWebhook(datos, msg)
      if (ok) {
        enviados.add(msgId)
        // Etiqueta de seguimiento (informativa; el dedup real es por ID de mensaje).
        try { thread.addLabel(labelProcesado) } catch (e) {}
        nuevos++
      } else {
        // Fallo (webhook rechazó/cayó) → a revisar y NO se marca (reintenta la próxima corrida).
        try { thread.addLabel(labelRevisar) } catch (e) {}
      }
    }
  }

  guardarIdsEnviados(props, enviados)
  Logger.log('Mensajes NUEVOS enviados al webhook: ' + nuevos)
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia de IDs de mensaje ya enviados (ScriptProperties)
// ─────────────────────────────────────────────────────────────────────────────
function leerIdsEnviados(props) {
  try {
    const raw = props.getProperty(CONFIG.PROP_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function guardarIdsEnviados(props, set) {
  let arr = Array.from(set)
  // Conservar los más recientes (se agregan al final) si supera el máximo.
  if (arr.length > CONFIG.MAX_IDS_GUARDADOS) arr = arr.slice(arr.length - CONFIG.MAX_IDS_GUARDADOS)
  props.setProperty(CONFIG.PROP_KEY, JSON.stringify(arr))
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser del cuerpo del email
// ─────────────────────────────────────────────────────────────────────────────
function parsearEmail(body) {
  if (!body) return null

  // Solo procesamos DEPÓSITOS (pagos entrantes). Los retiros/envíos ("Enviaste")
  // se descartan acá → el hilo queda en 'fiwind-revisar'.
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
// Utilidad: reprocesar un email puntual aunque ya figure como enviado.
// Pegá el ID de mensaje (o el idCoelsa) y ejecutá a mano si hace falta forzar
// el reenvío de uno específico. Para el ID de mensaje: abrí el email → ⋮ →
// "Mostrar original" → Message-ID; o usá _diagnosticarUltimo.
// ─────────────────────────────────────────────────────────────────────────────
function _forzarReenvioPorMsgId(msgId) {
  const props = PropertiesService.getScriptProperties()
  const enviados = new Set(leerIdsEnviados(props))
  enviados.delete(msgId)
  guardarIdsEnviados(props, enviados)
  Logger.log('Sacado del registro (se reenviará en la próxima corrida): ' + msgId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Prueba local del parser con el email de ejemplo (no envía nada).
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico: toma el último email de Fiwind, muestra su cuerpo real, el
// parseo y la respuesta del webhook. Ejecutar a mano y mirar el Registro.
// ─────────────────────────────────────────────────────────────────────────────
function _diagnosticarUltimo() {
  const threads = GmailApp.search('from:no-reply@fiwind.io', 0, 1)
  if (!threads.length) { Logger.log('No hay emails de Fiwind'); return }
  const msgs = threads[0].getMessages()
  Logger.log('Mensajes en el hilo: ' + msgs.length)
  for (let i = 0; i < msgs.length; i++) {
    const body = htmlAVexto(msgs[i].getBody())
    Logger.log('===== MSG ' + (i + 1) + ' | id: ' + msgs[i].getId() + ' | from: ' + msgs[i].getFrom() + ' =====')
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
