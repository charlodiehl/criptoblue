/**
 * ExchangeCopter → CriptoBlue (billetera "Copter MS", unidad de negocio MS)
 * ────────────────────────────────────────────────────────────────────────────
 * Lee los avisos de transferencia recibida de ExchangeCopter que llegan a
 * blue.finanzas.adm@gmail.com (reenviados automáticamente desde la casilla de
 * Nacho) y los manda al webhook de CriptoBlue.
 *
 * A diferencia de Fiwind/Montemar, acá NO se parsea nada del lado de Gmail: se
 * manda el asunto y el cuerpo crudos y el servidor extrae el pagador y el monto.
 * Así se ajusta el parseo sin volver a tocar el script.
 *
 * FECHA DEL PAGO = fecha del EMAIL (message.getDate()). El aviso no trae la hora
 * de la transferencia, y la de llegada del mail es la mejor aproximación.
 *
 * DEDUP POR MENSAJE: se guarda una marca 'ok_<idDeMensaje>' en ScriptProperties
 * y solo se marca cuando el webhook responde 2xx. Si falla, se reintenta en la
 * corrida siguiente. El servidor además deduplica por ese mismo id de mensaje,
 * así que un reenvío nunca entra dos veces.
 *
 * INSTALACIÓN: ver README.md de esta carpeta.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  WEBHOOK_URL: 'https://criptoblue.vercel.app/api/copter/webhook',

  // ⚠️ PEGÁ ACÁ TU SECRETO REAL (el mismo valor que COPTER_WEBHOOK_SECRET en Vercel).
  // NO se commitea el valor real en el repo.
  SECRET: 'CAMBIAR_POR_EL_SECRETO',

  // El filtro por remitente es lo que impide que un email cualquiera con esa
  // frase entre como pago: el secreto lo pone ESTE script, no el email, así que
  // sin el `from:` alcanzaría con mandarle un mail a la casilla para inyectar un
  // pago falso. El reenvío automático conserva el remitente original.
  QUERY: 'from:info-no-reply@exchangecopter.com "Recibiste una transferencia de" newer_than:7d',

  // Etiquetas de seguimiento (el dedup real es por ScriptProperties; estas son
  // para que se vea desde Gmail qué entró y qué hay que mirar a mano).
  LABEL_OK: 'copterok',
  LABEL_REVISAR: 'copter-revisar',

  // Tope de hilos por corrida. Holgado respecto de la ventana de búsqueda: a ~30
  // avisos por día, 7 días son ~210 hilos, y los ya procesados se saltean rápido.
  MAX_THREADS: 250,
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal — la que dispara el trigger (cada 5 minutos).
// ─────────────────────────────────────────────────────────────────────────────
function procesarPagosCopter() {
  const props = PropertiesService.getScriptProperties()
  const labelOk = obtenerOCrearLabel(CONFIG.LABEL_OK)
  const labelRevisar = obtenerOCrearLabel(CONFIG.LABEL_REVISAR)

  const threads = GmailApp.search(CONFIG.QUERY, 0, CONFIG.MAX_THREADS)
  Logger.log('Hilos encontrados: ' + threads.length)

  let nuevos = 0, fallados = 0
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const id = message.getId()

      // Ya enviado: se le pone la etiqueta igual. Sirve de backfill para los
      // emails que entraron con una versión del script que no etiquetaba.
      if (props.getProperty('ok_' + id)) {
        marcarOk(thread, labelOk, labelRevisar)
        continue
      }

      const body = message.getPlainBody() || ''
      // Ignora débitos y otros avisos que caigan en la misma búsqueda.
      if (!/Recibiste una transferencia de/i.test(body)) continue

      const payload = {
        asunto: message.getSubject(),
        cuerpo: body,
        fechaISO: message.getDate().toISOString(),   // fecha/hora de llegada del email
        messageId: id,
      }

      try {
        const res = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + CONFIG.SECRET },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        })
        const code = res.getResponseCode()
        if (code >= 200 && code < 300) {
          // Se marca SOLO si entró bien; si falla, se reintenta en la próxima corrida.
          props.setProperty('ok_' + id, '1')
          marcarOk(thread, labelOk, labelRevisar)
          nuevos++
          Logger.log('Copter OK: ' + res.getContentText())
        } else {
          try { thread.addLabel(labelRevisar) } catch (e) {}
          fallados++
          Logger.log('Copter ' + code + ': ' + res.getContentText())
        }
      } catch (e) {
        try { thread.addLabel(labelRevisar) } catch (e2) {}
        fallados++
        Logger.log('Copter error: ' + e)
      }
    }
  }
  Logger.log('Nuevos enviados: ' + nuevos + ' | pendientes de revisar: ' + fallados)
}

// Marca el hilo como procesado y le saca la etiqueta de revisar (por si venía de
// un intento fallido anterior que después salió bien).
function marcarOk(thread, labelOk, labelRevisar) {
  try { thread.addLabel(labelOk) } catch (e) {}
  try { thread.removeLabel(labelRevisar) } catch (e) {}
}

function obtenerOCrearLabel(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre)
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecutar UNA vez a mano para programar la corrida automática cada 5 minutos.
// ─────────────────────────────────────────────────────────────────────────────
function crearTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesarPagosCopter') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('procesarPagosCopter').timeBased().everyMinutes(5).create()
  Logger.log('Trigger creado: cada 5 minutos.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico: muestra qué encuentra la búsqueda y qué se mandaría, SIN mandar.
// Ejecutar a mano y mirar Ver → Registros.
// ─────────────────────────────────────────────────────────────────────────────
function _diagnosticar() {
  const props = PropertiesService.getScriptProperties()
  const threads = GmailApp.search(CONFIG.QUERY, 0, 10)
  Logger.log('Query: ' + CONFIG.QUERY)
  Logger.log('Hilos (primeros 10): ' + threads.length)
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const id = message.getId()
      Logger.log([
        message.getDate().toISOString(),
        props.getProperty('ok_' + id) ? 'YA ENVIADO' : 'PENDIENTE',
        message.getSubject(),
      ].join(' | '))
    }
  }
}
