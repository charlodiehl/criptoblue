# Gmail → CriptoBlue (Google Apps Script)

Scripts que leen avisos de pago desde una casilla de Gmail y los mandan a un
webhook de la app. Uno por medio de pago:

| Script | Casilla | Webhook | Billetera · unidad |
|---|---|---|---|
| `copter-a-criptoblue.gs` | `blue.finanzas.adm@gmail.com` | `/api/copter/webhook` | Copter MS · **ms** |
| `fiwind-a-criptoblue.gs` | `comprobantespagosblue@gmail.com` | `/api/fiwind/webhook` | MF · criptoblue *(desconectada)* |
| `montemar-a-criptoblue.gs` | `comprobantespagosblue@gmail.com` | `/api/montemar/webhook` | Montemar · criptoblue *(desconectada)* |

> El secreto real **nunca** va en estos archivos: se pega en el Apps Script y
> tiene que coincidir con la env var correspondiente en Vercel.

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
ejecutar `crearTrigger` una vez (corre cada 5 minutos).

**Duplicados:** marca `ok_<idDeMensaje>` en ScriptProperties, y **solo** cuando
el webhook responde 2xx — si falla, reintenta. El servidor deduplica por el mismo
id, así que un reenvío nunca entra dos veces.

**Etiquetas:** `copterok` cuando entró; `copter-revisar` cuando falló (esas son
las que hay que mirar a mano). Son informativas: el dedup real es el de arriba.

**Por qué el `from:` en la búsqueda:** el secreto lo pone el script, no el email.
Sin filtrar por `info-no-reply@exchangecopter.com`, cualquiera que le mande un
mail a la casilla con la frase y un monto inyecta un pago falso en la cola.

---

## Fiwind → CriptoBlue

Lee los emails de Fiwind que llegan a `comprobantespagosblue@gmail.com`, extrae los
datos de cada transferencia y los envía al webhook de CriptoBlue
(`/api/fiwind/webhook`). Corre gratis dentro de Google Apps Script.

## Qué extrae del email

Del cuerpo (formato fijo de Fiwind):

| Campo email | Se envía como | Ejemplo |
|---|---|---|
| Monto | `monto` (número) | `116977.51` |
| Fecha | `fechaISO` (ART −03:00) | `2026-01-24T14:36:00-03:00` |
| Titular | `nombre` (Nombre Apellido) | `ROMINA FACCIO` |
| CBU/CVU | `cbuCvu` | `0340251308730018946006` |
| Banco | `banco` | `Banco Patagonia` |
| ID COELSA | `idCoelsa` (id único) | `76V4MR2Z7D7PG8K9NDEZOL` |

> El email **no trae CUIT**. El emparejamiento con la orden se hace por
> **nombre + monto + fecha**.

## Instalación (una vez)

1. Entrá a **script.google.com** con la cuenta `comprobantespagosblue@gmail.com`.
2. **Nuevo proyecto** → pegá el contenido de `fiwind-a-criptoblue.gs` en `Código.gs`.
3. En `CONFIG` (arriba del archivo) ajustá:
   - `WEBHOOK_SECRET`: el mismo valor que la env var `FIWIND_WEBHOOK_SECRET` en Vercel.
   - `WEBHOOK_URL`: dejala en `https://criptoblue.vercel.app/api/fiwind/webhook` (ya está).
4. **Probar el parser** sin enviar nada: ejecutá la función `_probarParser` y mirá
   **Ver → Registros**. Tiene que salir el JSON con los datos del ejemplo.
5. **Autorizar permisos**: la primera ejecución pide permiso para leer Gmail y
   hacer requests externos. Aceptar.
6. **Activar el trigger**: ejecutá la función `crearTrigger` una vez. Eso programa
   `procesarEmailsFiwind` para correr **cada 5 minutos**.

## Cómo evita duplicados

- Solo procesa hilos que **no** tienen la etiqueta `fiwind-procesado`.
- Al enviar bien un email, le pone esa etiqueta.
- Si un email matchea la búsqueda pero no parsea o el webhook lo rechaza, le pone
  `fiwind-revisar` para mirarlo a mano.
- El `idCoelsa` es único por transferencia → el webhook deduplica por ahí.

## Búsqueda de emails

`CONFIG.SEARCH_QUERY` filtra por `from:no-reply@fiwind.io -label:fiwind-procesado`.
El reenvío automático conserva el remitente original `no-reply@fiwind.io` (igual
que en los emails anteriores), así que ese filtro es confiable. Si algún día el
reenvío cambiara el "De", se puede sumar un filtro de Gmail que etiquete los
emails de Fiwind y buscar por esa etiqueta.

## Falta del otro lado

El endpoint `POST /api/fiwind/webhook` en CriptoBlue (Next.js) que:
1. valida el `secret`,
2. deduplica por `idCoelsa`,
3. arma un `Payment` y lo mete en `unmatchedPayments` para que el auto-match lo
   empareje por nombre + monto + fecha.
