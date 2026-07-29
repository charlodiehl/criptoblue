# Gmail → CriptoBlue (Google Apps Script)

Scripts que leen avisos de pago desde una casilla de Gmail y los mandan a un
webhook de la app.

| Script | Casilla | Webhook | Billetera · unidad |
|---|---|---|---|
| `copter-a-criptoblue.gs` | `blue.finanzas.adm@gmail.com` | `/api/copter/webhook` | Copter Hemat · **ms** |

> El secreto real **nunca** va en estos archivos: se pega en el Apps Script y
> tiene que coincidir con la env var correspondiente en Vercel.

**Circuitos por email que NO están versionados acá** (viven solo en Apps Script):
`/api/bitso/webhook` (Bitso FluoGames) y `/api/lbfinanzas/webhook` (MS). Conviene
traerlos a este directorio, por el mismo motivo por el que está el de Copter: si
se pierde el proyecto de Apps Script, no hay forma de reconstruirlos.

**Retirados:** los scripts de Fiwind y Montemar se borraron en julio de 2026,
cuando se desconectaron esas billeteras y se eliminaron sus webhooks
(`/api/fiwind/webhook`, `/api/montemar/webhook`). El histórico de sus pagos sigue
en el registro. Si alguna vez hicieran falta, están en el historial de git.

---

## ⚠️ Cuota de Gmail — leer antes de tocar cualquiera de estos scripts

Una cuenta Gmail común permite **~20.000 operaciones de Gmail por día** desde Apps
Script. Pasarse tira `Service invoked too many times for one day: gmail` y **el
script deja de mandar pagos hasta el reseteo diario**, en silencio.

Pasó el **25/7/2026** con Copter: la versión anterior re-etiquetaba *todo lo ya
procesado* en cada corrida (2 escrituras por mensaje × ~250 hilos × 288 corridas
≈ 200.000 ops/día). Estuvo ~3 horas sin ingresar pagos.

Dos reglas para no repetirlo:

1. **Nunca tocar Gmail para lo ya procesado.** Si está marcado en
   `ScriptProperties`, `continue` y listo — nada de re-etiquetar por las dudas.
2. **La ventana de búsqueda y la frecuencia del trigger se compensan.** El costo
   por corrida es ≈ 1 (`search`) + 1 por hilo (`getMessages`). Con trigger cada 5
   minutos la ventana tiene que ser `newer_than:1d` (~35 hilos × 288 corridas ≈
   10.400 ops/día). Con `newer_than:2d` a 5 minutos serían ~20.400 — justo en el
   límite. Si se quiere una ventana más amplia, hay que espaciar el trigger.

En el activador conviene dejar **"Notifícame inmediatamente"** en notificaciones
de falla: con la ventana de 1 día, la recuperación ante un corte es de 24 horas.

---

## ExchangeCopter → CriptoBlue

Avisos de "Recibiste una transferencia" que ExchangeCopter manda a la casilla de
Nacho y se reenvían automáticamente a `blue.finanzas.adm@gmail.com`.

**Qué manda:** el asunto y el cuerpo **crudos** + `fechaISO` + `messageId`. El
pagador y el monto los extrae el servidor (`app/api/copter/webhook/route.ts`),
así que el parseo se ajusta sin volver a tocar el script.

**La fecha del pago es la del EMAIL** (`message.getDate()`): el aviso no trae la
hora de la transferencia.

**Instalación:** `script.google.com` con `blue.finanzas.adm@gmail.com` → pegar
`copter-a-criptoblue.gs` → poner `CONFIG.SECRET` (= `COPTER_WEBHOOK_SECRET` en
Vercel) → ejecutar `_diagnosticar` para ver qué encuentra sin mandar nada →
ejecutar `crearTrigger` una vez (usa `CONFIG.MINUTOS_TRIGGER`).

**Duplicados:** marca `ok_<idDeMensaje>` en ScriptProperties, y **solo** cuando
el webhook responde 2xx — si falla, reintenta. El servidor deduplica por el mismo
id, así que un reenvío nunca entra dos veces. La ventana de búsqueda **no** es el
dedup: es solo cuánto pasado se re-escanea.

**Etiquetas:** `copterok` cuando entró; `copter-revisar` cuando falló (esas son
las que hay que mirar a mano). Son informativas: el dedup real es el de arriba.

**Por qué el `from:` en la búsqueda:** el secreto lo pone el script, no el email.
Sin filtrar por `info-no-reply@exchangecopter.com`, cualquiera que le mande un
mail a la casilla con la frase y un monto inyecta un pago falso en la cola.
