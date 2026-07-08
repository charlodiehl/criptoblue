/**
 * Montemar pay → CriptoBlue
 * ────────────────────────────────────────────────────────────────────────────
 * Lee los emails "Transferencia Recibida" de Montemar pay que llegan a la casilla
 * Gmail, extrae los datos de la transferencia y los envía al webhook de CriptoBlue.
 *
 * Es el MISMO mecanismo que el de Fiwind (Apps Script → webhook), adaptado al
 * formato del email de Montemar. Corre dentro de Google Apps Script
 * (script.google.com), disparado por un trigger por tiempo (cada 5 minutos).
 *
 * DEDUP POR MENSAJE (no por hilo): Gmail agrupa emails parecidos en un mismo hilo.
 * Se lleva un registro de los IDs de MENSAJE ya enviados en ScriptProperties, y se
 * evalúa cada mensaje por separado (así un email nuevo dentro de un hilo viejo no
 * queda excluido).
 *
 * INSTALACIÓN: ver README.md de esta carpeta (mismo procedimiento que Fiwind).
 * ────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  // URL del endpoint de CriptoBlue (producción).
  WEBHOOK_URL: 'https://criptoblue.vercel.app/api/montemar/webhook',

  // ⚠️⚠️ PEGÁ ACÁ TU SECRETO REAL ⚠️⚠️  (el mismo valor que MONTEMAR_WEBHOOK_SECRET en Vercel).
  WEBHOOK_SECRET: 'CAMBIAR_POR_EL_SECRETO',

  // Búsqueda: emails de Montemar de los últimos N días. NO se filtra por etiqueta —
  // el dedup es por ID de mensaje (ver abajo). La ventana acota el volumen.
  SEARCH_QUERY: 'from:contacto@montemarpay.com.ar newer_than:3d',

  // ── Etiquetas (CUSTOMIZABLES: cambiá los nombres a gusto) ─────────────────
  // Se aplica a los emails ya enviados a la app, para que lleves el seguimiento.
  LABEL_PROCESADO: 'montemar-procesado',
  // Se aplica a los emails que no se pudieron parsear/enviar (revisión manual).
  LABEL_REVISAR: 'montemar-revisar',

  // Máximo de hilos por corrida (evita timeouts). Se procesan del más nuevo al más viejo.
  MAX_THREADS: 80,

  // Clave en ScriptProperties donde se guardan los IDs de mensaje ya enviados.
  PROP_KEY: 'montemar_msgids_enviados',
  // Cuántos IDs conservar (poda). Debe cubrir de sobra la ventana de búsqueda.
  MAX_IDS_GUARDADOS: 1500,
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal — la que dispara el trigger.
// ─────────────────────────────────────────────────────────────────────────────
function procesarEmailsMontemar() {
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

      // Montemar manda los datos en el cuerpo HTML; el texto plano puede perderlos.
      const datos = parsearEmail(htmlAVexto(msg.getBody()))
      if (!datos) {
        // No es "recibida" o no parseó → a revisar. NO se marca como enviado
        // (por si es una transferencia recibida real que hay que corregir a mano).
        try { thread.addLabel(labelRevisar) } catch (e) {}
        continue
      }

      const ok = enviarAlWebhook(datos, msg)
      if (ok) {
        enviados.add(msgId)
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
  if (arr.length > CONFIG.MAX_IDS_GUARDADOS) arr = arr.slice(arr.length - CONFIG.MAX_IDS_GUARDADOS)
  props.setProperty(CONFIG.PROP_KEY, JSON.stringify(arr))
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser del cuerpo del email
// ─────────────────────────────────────────────────────────────────────────────
function parsearEmail(body) {
  if (!body) return null

  // Solo procesamos transferencias RECIBIDAS (pagos entrantes). El monto sale de la
  // línea "Recibiste una transferencia de $ ..."; si el email es "Enviaste"/egreso,
  // esa línea no existe → extraerMonto devuelve null y el email queda en 'revisar'.
  const monto = extraerMonto(body)
  const fechaISO = extraerFecha(body)
  const nombre = extraerCampo(body, 'Nombre')                       // orden natural, sin reordenar
  const cuit = extraerCampo(body, 'CUIL/CUIT origen').replace(/\D/g, '')
  const cbuOrigen = extraerCampo(body, 'CBU/CVU origen').replace(/\s/g, '')
  const cvuDestino = extraerCampo(body, 'CVU destino').replace(/\s/g, '')
  const idCoelsa = extraerIdCoelsa(body)

  // Sin monto, sin fecha o sin ID no podemos emparejar/deduplicar: email inválido.
  if (!monto || !fechaISO || !idCoelsa) return null

  return { monto, fechaISO, nombre, cuit, cbuOrigen, cvuDestino, idCoelsa, raw: body }
}

// "Recibiste una transferencia de $ 20000.0"  → 20000
// Montemar envía el monto en formato en-US (punto = decimal, sin separador de
// miles, ej "20000.0"). Se quitan comas por si un monto grande viniera "1,234.56".
function extraerMonto(body) {
  const m = body.match(/Recibiste una transferencia de\s*\$?\s*([\d.,]+)/i)
  if (!m) return null
  const num = parseFloat(m[1].replace(/,/g, ''))
  return isFinite(num) && num > 0 ? num : null
}

// "Fecha y hora: 2026-07-04 07:54:46" (yyyy-mm-dd HH:MM:SS) → ISO con offset Argentina (-03:00)
function extraerFecha(body) {
  const m = body.match(/Fecha y hora:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '-03:00'
}

// "ID Coelsa: RD06ZO9W4EPPXL7525GP7X" → identificador único de la transferencia.
function extraerIdCoelsa(body) {
  const m = body.match(/ID\s*Coelsa:\s*([A-Za-z0-9]+)/i)
  return m ? m[1].trim() : ''
}

// Extrae el valor de una línea "Etiqueta: valor". Escapa caracteres especiales del label.
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
        cuit: datos.cuit,
        fechaISO: datos.fechaISO,
        cbuOrigen: datos.cbuOrigen,
        cvuDestino: datos.cvuDestino,
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
    if (t.getHandlerFunction() === 'procesarEmailsMontemar') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('procesarEmailsMontemar').timeBased().everyMinutes(5).create()
  Logger.log('Trigger creado: cada 5 minutos.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidad: "sellar" TODOS los emails de Montemar actuales como ya enviados, SIN
// postearlos. Ejecutar UNA sola vez ANTES de crearTrigger si querés arrancar "de
// ahora en adelante": el script ignora los pagos que ya están en la casilla y
// solo carga los que lleguen a partir de este momento.
// ─────────────────────────────────────────────────────────────────────────────
function _sellarActualesSinEnviar() {
  const props = PropertiesService.getScriptProperties()
  const enviados = new Set(leerIdsEnviados(props))
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.MAX_THREADS)
  let n = 0
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      if (!enviados.has(msg.getId())) { enviados.add(msg.getId()); n++ }
    }
  }
  guardarIdsEnviados(props, enviados)
  Logger.log('Sellados como ya enviados (NO se postearon): ' + n + '. Desde ahora solo se cargan los emails nuevos.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidad: reprocesar un email puntual aunque ya figure como enviado.
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
    'Transferencia recibida',
    'Hola TAORMINA DANIEL!',
    'Recibiste una transferencia de $ 20000.0',
    'Nombre: Maria Soledad Lopez',
    'CUIL/CUIT origen: 27409953374',
    'CBU/CVU origen: 0000031000051869747201',
    'CVU destino: 0000170600023107810239',
    'Fecha y hora: 2026-07-04 07:54:46',
    'ID Coelsa: RD06ZO9W4EPPXL7525GP7X',
  ].join('\n')

  const datos = parsearEmail(ejemplo)
  Logger.log(JSON.stringify(datos, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico: toma el último email de Montemar, muestra su cuerpo real, el
// parseo y la respuesta del webhook. Ejecutar a mano y mirar el Registro.
// ─────────────────────────────────────────────────────────────────────────────
function _diagnosticarUltimo() {
  const threads = GmailApp.search('from:contacto@montemarpay.com.ar', 0, 1)
  if (!threads.length) { Logger.log('No hay emails de Montemar'); return }
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
          nombre: datos.nombre, cuit: datos.cuit, fechaISO: datos.fechaISO,
          cbuOrigen: datos.cbuOrigen, cvuDestino: datos.cvuDestino, raw: datos.raw, emailId: msgs[i].getId(),
        }),
      })
      Logger.log('WEBHOOK: HTTP ' + resp.getResponseCode() + ' → ' + resp.getContentText())
    }
  }
}
