# PLAN — Portal de Tiendas + Administración Financiera + Auth Google/2FA

> **ESTADO (07/07/2026): TODAS las fases (F1–F3, O1–O3) PROGRAMADAS y verificadas en local.**
> tsc limpio · eslint 0 errores · build limpio (todas las rutas registradas: `/tienda`, `/finanzas`,
> 6 APIs `/api/tienda/*`, 5 APIs `/api/finanzas/*`) · middleware probado en runtime (redirects,
> 401 en TODAS las APIs nuevas, webhooks y cron intactos) · `calcularDescuento` 10/10 · `validarDatosSolicitud` 10/10.
> **NO pusheado** — falta la parte del usuario para el cutover: §2.5 (Google/Supabase Auth) +
> migración SQL `migrations/2026-07-portal-finanzas.sql` + `node scripts/setup-portal.mjs` + alta de usuarios.
> Lo único sin probar en vivo (bloqueado por eso): OAuth/MFA reales y los flujos con datos reales
> (balance, solicitud→pago con descuento, reclamo). El código está completo; se prueba cuando el usuario
> termine su parte y unamos todo. Después: build + **push con OK explícito**.

> **Modelos:** las fases marcadas **[FABLE]** las programa Fable 5 (cimientos: auth, datos, lógica de riesgo).
> Las marcadas **[OPUS]** las ejecuta Opus 4.8 siguiendo este documento al pie de la letra.
> Cada fase tiene *criterios de aceptación*. No avanzar de fase sin cumplirlos.
> Regla de oro del proyecto: build limpio antes de push, push solo con OK explícito del usuario.

---

## 0. Decisiones ya tomadas con el usuario (NO re-preguntar)

| Tema | Decisión |
|---|---|
| Sistema de auth | **Supabase Auth** (Google OAuth + MFA TOTP nativos) |
| Gestión de usuarios/roles | **Carga manual en tabla** `app_users` (sin UI de administración) |
| Roles | `admin` y `tienda`. Email sin rol → pantalla de bloqueo ("No tenés permiso para acceder, comunicate con un administrador") y nada más |
| 2FA | **Obligatorio para ambos roles**, con app de autenticación (TOTP). Se configura en el primer ingreso |
| Balance | Arranca en **0 el día del deploy**. Después el usuario dará **saldos iniciales** (se cargan como movimientos `ajuste`) |
| Cotización USDT | Se captura **en el momento del emparejamiento** vía API externa que el usuario pasará DESPUÉS. Mientras tanto: movimiento con `usdt = NULL`, `rate_source = 'pendiente'`. La UI muestra el USDT como "pendiente de cotización". Estructura lista para backfill |
| Buscar pagos (tienda) | Busca en **todos** los pagos pendientes (sin restricción de billetera) |
| Reclamar pago | **Valida la orden y la marca en TiendaNube/Shopify** (mismo flujo que emparejamiento manual) |
| Ciclo solicitudes | **Solo Pendiente → Pagada** (sin rechazo ni cancelación) |
| Volumen reclamado | Suma al bucket **automatizado** (`matchedCount/matchedVolume`) |

**Defaults elegidos por el arquitecto (avisar al usuario, puede vetar):**
- Comprobantes → bucket privado de Supabase Storage `comprobantes`, URL firmada para ver.
- Feed de reclamos en Admin general → últimos 7 días (informativo).
- Pérdida del 2FA → reset manual (borrar factor con service key; script en `scripts/`).
- La tienda ve el listado de sus propias solicitudes con estado debajo del formulario.
- Entradas `hidden` del registro **sí** cuentan para el balance (hidden es cosmético de UI).

---

## 1. Arquitectura de datos — 3 tablas nuevas (migración SQL)

Archivo: `migrations/2026-07-portal-finanzas.sql`. Se ejecuta en la consola SQL de Supabase ANTES del deploy (patrón ya usado en `migrations/2026-05-registro-log.sql`). Acceso SIEMPRE vía service key desde rutas del server (RLS deny-all para anon, igual que registro_log).

```sql
-- 1) Usuarios de la app (carga manual)
CREATE TABLE IF NOT EXISTS app_users (
  email       TEXT PRIMARY KEY,              -- SIEMPRE lowercase
  role        TEXT NOT NULL CHECK (role IN ('admin','tienda')),
  store_id    TEXT,                          -- obligatorio si role='tienda' (id de criptoblue:stores)
  display_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tienda_requiere_store CHECK (role <> 'tienda' OR store_id IS NOT NULL)
);

-- 2) Solicitudes de transferencia
CREATE TABLE IF NOT EXISTS transfer_requests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ars','usd','usdt')),
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada')),
  datos       JSONB NOT NULL,                -- campos del formulario según tipo (ver §4.2)
  created_by  TEXT NOT NULL,                 -- email del solicitante
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at     TIMESTAMPTZ,
  paid_by     TEXT,                          -- email del admin que pagó
  comprobante_path TEXT,                     -- path en bucket 'comprobantes' (nullable)
  descuento   JSONB                          -- ver §5.2: {moneda, monto, tasas..., arsDescontado, usdtDescontado}
);
CREATE INDEX IF NOT EXISTS transfer_requests_store_idx  ON transfer_requests (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_requests_estado_idx ON transfer_requests (estado) WHERE estado = 'pendiente';

-- 3) Movimientos de balance (libro mayor por tienda)
CREATE TABLE IF NOT EXISTS balance_movements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ingreso_orden','egreso_transferencia','ajuste')),
  fecha       TIMESTAMPTZ NOT NULL,          -- momento del hecho (emparejamiento / pago / ajuste)
  ars         NUMERIC NOT NULL,              -- SIGNADO: ingresos +, egresos −
  usdt        NUMERIC,                       -- SIGNADO; NULL = cotización pendiente
  usdt_rate   NUMERIC,                       -- cotización ARS/USDT usada (NULL si pendiente)
  rate_source TEXT NOT NULL DEFAULT 'pendiente' CHECK (rate_source IN ('api','manual','pendiente')),
  ref_registro_id BIGINT,                    -- FK lógica a registro_log.id (ingresos)
  ref_transfer_id BIGINT,                    -- FK lógica a transfer_requests.id (egresos)
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS balance_movements_store_idx ON balance_movements (store_id, fecha DESC);
CREATE INDEX IF NOT EXISTS balance_movements_pend_idx  ON balance_movements (rate_source) WHERE rate_source = 'pendiente';

-- RLS deny-all (acceso solo por service key)
ALTER TABLE app_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_movements ENABLE ROW LEVEL SECURITY;
```

**Balance de una tienda** = `SUM(ars)` y `SUM(usdt)` (ignorando NULL) de `balance_movements WHERE store_id = X`, + contador de movimientos con `rate_source='pendiente'` para el badge "N sin cotización".

**Bucket Storage:** crear bucket **privado** `comprobantes` en Supabase (Dashboard → Storage). Subida desde ruta server con service key; visualización con `createSignedUrl` (60 min).

---

## 2. FASE F1 [FABLE] — Autenticación: Google OAuth + 2FA + roles

### 2.1 Dependencia nueva
`npm i @supabase/ssr` (el proyecto usa `@supabase/supabase-js` ^2.49 — compatible).

### 2.2 Archivos nuevos
- `lib/auth/server.ts` — `createServerClient` (cookies de Next 16), helpers:
  - `getSessionUser()` → `{ email, role, storeId, aal, hasMfa } | null` (combina sesión Supabase + fila de `app_users`; email SIEMPRE lowercase).
  - `requireAdmin()` / `requireTienda()` para rutas API (devuelven 401/403).
- `lib/auth/client.ts` — `createBrowserClient` para componentes.
- `app/auth/callback/route.ts` — intercambio `code → session` (`exchangeCodeForSession`), luego redirige según estado: sin fila en app_users → `/login?blocked=1` (con signOut); sin factor TOTP → `/auth/mfa`; con factor y AAL1 → `/auth/mfa?challenge=1`; AAL2 → `/` o `/tienda` según rol.
- `app/auth/mfa/page.tsx` — doble modo:
  - **Enrolar** (primer ingreso): `mfa.enroll({factorType:'totp'})` → muestra QR + secreto manual → input 6 dígitos → `mfa.challenge` + `mfa.verify` → redirige por rol.
  - **Challenge** (ingresos siguientes): input 6 dígitos → verify → AAL2 → redirige por rol.
- `scripts/reset-mfa.mjs` — borra factores TOTP de un email (service key, `auth.admin`) para cuando alguien pierde el teléfono.
- `scripts/agregar-usuario.mjs` — inserta/actualiza fila en `app_users` (email, role, store_id) — así la "carga manual" es un comando y no SQL a mano.

### 2.3 Archivos modificados
- `app/login/page.tsx` — REEMPLAZO TOTAL: botón "Continuar con Google" (`signInWithOAuth({provider:'google', options:{redirectTo: <origin>/auth/callback}})`), mismo estilo dark/cyan. Si `?blocked=1` → pantalla de bloqueo: "No tenés permiso para acceder. Comunicate con un administrador." y NADA más (sin botón de reintentar login visible salvo "volver").
- `proxy.ts` — REEMPLAZO del control de sesión:
  1. Rutas públicas: igual que hoy (`/login`, `/auth/*` nuevas, webhooks, connects/callbacks TN/Shopify) — se agrega `/auth/callback`, `/auth/mfa`.
  2. Cron: igual que hoy (CRON_SECRET).
  3. Resto: sesión Supabase válida + fila en `app_users` + **AAL2** (si tiene factor) o redirect a `/auth/mfa` (si no tiene factor todavía). Sin fila → redirect `/login?blocked=1`.
  4. **Gate por rol y path:**
     - `role='tienda'`: solo puede `/tienda/**`, `/api/tienda/**`, `/auth/**`. Cualquier otra cosa → redirect `/tienda`.
     - `role='admin'`: todo.
  - ⚠️ El middleware de Next corre en Edge: usar `@supabase/ssr` con `getUser()`/`getClaims()` (NO service key en edge). La consulta a `app_users` en el middleware se hace vía claim cacheada en cookie liviana (`cb_role`) seteada por `/auth/callback` y re-validada en cada ruta API server-side (defensa en profundidad: el middleware filtra UX, las rutas API re-verifican SIEMPRE con `getSessionUser()`).
- `app/api/auth/login/route.ts` — se elimina el POST (login viejo). El DELETE se convierte en logout Supabase (`signOut`) + borrar cookies.
- `app/page.tsx` — el botón "Cerrar sesión" del menú usuario llama al nuevo logout. Mostrar email del usuario logueado en el menú.

### 2.4 Variables de entorno
Ninguna nueva en Vercel (usa `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` ya presentes). Las credenciales Google viven en el dashboard de Supabase, no en la app.

### 2.5 Lo que arma EL USUARIO (checklist de tu lado)
1. **Google Cloud Console** (console.cloud.google.com) → proyecto nuevo o existente → "APIs y servicios" → "Pantalla de consentimiento OAuth" (tipo Externo, publicada) → "Credenciales" → **Crear ID de cliente OAuth** (tipo: Aplicación web):
   - Orígenes autorizados: `https://criptoblue.vercel.app` y `http://localhost:3456`
   - URI de redirección: `https://<PROJECT_REF>.supabase.co/auth/v1/callback` (el valor exacto lo muestra Supabase en el paso 2)
   - Copiar **Client ID** y **Client Secret**.
2. **Supabase Dashboard** → Authentication → Sign In / Providers → **Google**: habilitar y pegar Client ID + Secret.
3. **Supabase Dashboard** → Authentication → Multi-Factor → verificar **TOTP habilitado**.
4. **Supabase Dashboard** → Authentication → URL Configuration: Site URL `https://criptoblue.vercel.app`; Redirect URLs: `https://criptoblue.vercel.app/auth/callback`, `http://localhost:3456/auth/callback`.
5. **Pasar la lista de usuarios**: email de Google + rol + tienda (para role tienda). Mínimo: tu email como `admin`.

### 2.6 Criterios de aceptación F1
- Login con Google de un email en `app_users` → fuerza enrolar TOTP → tras verificar entra a `/` (admin) o `/tienda` (tienda).
- Segundo login → pide código TOTP (challenge) antes de entrar.
- Email NO cargado → pantalla de bloqueo exacta, sin acceso a ninguna ruta.
- Rol tienda intentando `/` o `/api/log` → rebotado a `/tienda` / 403.
- Webhooks (fiwind/notificador/montemar) y cron siguen funcionando sin tocar (probar con secret inválido → 401 propio, no redirect a login).
- `npm run build` limpio.

---

## 3. FASE F2 [FABLE] — Capa de datos: balance, cotización, migración

### 3.1 Archivos nuevos
- `migrations/2026-07-portal-finanzas.sql` — el SQL de §1.
- `lib/cotizacion.ts` — adaptador de cotización USDT:
  ```ts
  // Devuelve la cotización ARS por 1 USDT para una fecha dada, o null si no hay fuente.
  // TODO: conectar la API que pase el usuario. Hasta entonces SIEMPRE null → los
  // movimientos quedan rate_source='pendiente' y el backfill los completa después.
  export async function getUsdtRate(fecha: Date): Promise<number | null> { return null }
  ```
- `lib/balance.ts`:
  - `registrarIngresoOrden(registroId, entry: LogEntry)` — crea movimiento `ingreso_orden` (ars = `entry.amount`, usdt = ars/rate si `getUsdtRate` devuelve valor, sino NULL/pendiente). Se llama SOLO para `action` auto_paid/manual_paid con `storeId`.
  - `registrarEgresoTransferencia(transfer, descuento)` — movimiento negativo con los montos calculados (§5.2).
  - `registrarAjuste(storeId, ars, usdt, descripcion)` — para saldos iniciales.
  - `getBalance(storeId)` → `{ ars, usdt, pendientes }` (SUMs SQL).
  - `getBalances()` → lo mismo para todas las tiendas en una query (GROUP BY).
  - `getMovimientosDia(storeId, fechaART)` → movimientos de un día (para cruzar cotización en la tabla del portal).
- `scripts/backfill-cotizaciones.mjs` — recorre `balance_movements WHERE rate_source='pendiente'`, pide `getUsdtRate(fecha)` y completa `usdt`/`usdt_rate`/`rate_source='api'`. Se corre a mano cuando la API esté conectada.
- `scripts/cargar-saldo-inicial.mjs` — inserta `ajuste` por tienda (para cuando el usuario pase los saldos).

### 3.2 Archivos modificados
- `lib/registro.ts` — `appendRegistroEntry` y `appendRegistroEntries`: tras el INSERT (con `.select('id')` para obtener el id), si `action ∈ {auto_paid, manual_paid}` y hay `storeId` → `registrarIngresoOrden(id, entry)`. Envuelto en try/catch con `appendError` (un fallo de balance NUNCA debe romper el registro de un pago — el backfill puede reconstruir después por `ref_registro_id` faltante).
- `lib/types.ts` — extender `LogEntry['source']` con `'tienda_buscar'`; tipos nuevos `TransferRequest`, `BalanceMovement`, `AppUser`.

### 3.3 Criterios de aceptación F2
- Migración corre idempotente (IF NOT EXISTS) en Supabase.
- Emparejar un pago (manual o auto) en local → aparece movimiento `ingreso_orden` con `ars` correcto y `usdt NULL/pendiente`, `ref_registro_id` apuntando a la fila del registro.
- `getBalance` refleja SUM correcto; `getBalances` agrupa bien.
- Un fallo simulado en `balance_movements` NO impide que el registro se escriba.
- Build limpio.

---

## 4. FASE O1 [OPUS] — Portal Tienda (`/tienda`) + APIs de tienda

### 4.0 Regla de seguridad para TODA ruta `/api/tienda/**`
El `storeId` **NUNCA viene del cliente** para rol tienda: se deriva de `getSessionUser().storeId`. Un `admin` SÍ puede pasar `?storeId=` explícito (lo usa la vista espejo de F5/O2). Implementar helper único `resolveStoreScope(req)` en `lib/auth/server.ts` que encapsula esto — usarlo en todas las rutas tienda.

### 4.1 Layout `/tienda`
`app/tienda/page.tsx` (+ componentes en `components/tienda/`). Mismo tema dark/cyan (reusar variables de `globals.css`).
- **Header**: mismo estilo del actual (grid 3 columnas): logo (izq, el mismo de la app), centro vacío, derecha avatar usuario (menú con email + cerrar sesión) y **nombre de la tienda** bien visible.
- **Barra de pestañas** horizontal debajo (mismo patrón visual de tabs de `app/page.tsx` líneas ~798): `Balance de Saldo` (default) · `Solicitar transferencias` · `Buscar pagos`.
- El componente raíz del portal recibe `storeId` y `storeName` como props ⇒ **reutilizable por el admin** en la vista espejo (O2). Crear `components/tienda/TiendaPortal.tsx` con prop `admin?: boolean`.

### 4.2 Pestaña 1 — "Balance de Saldo" (`components/tienda/BalanceTab.tsx`)
- **Tarjeta de balance global** (estilo StatsBar): dos valores grandes — **USDT** y **ARS** (`getBalance`). Si `pendientes > 0`, badge: "N movimientos sin cotización — el saldo USDT es parcial".
- **Selector de fecha** (input date, default hoy, en ART). Solo un día a la vez.
- **Tabla de órdenes del día** (registro filtrado `storeId` + día ART + action auto/manual_paid; misma estética de `RegistroTab`): columnas Fecha y hora · Monto (ARS) · **Cotización de USDT** (del movimiento vinculado; "Pendiente" si NULL) · Equivalente USDT ("—" si pendiente) · CUIT · Nombre · N° orden · Billetera.
- API: `GET /api/tienda/balance` → `{ ars, usdt, pendientes }`; `GET /api/tienda/registro?fecha=YYYY-MM-DD` → entries del día + mapa `registroId → {usdtRate, usdt}` (join server-side vía `ref_registro_id`).

### 4.3 Pestaña 2 — "Solicitar transferencias" (`components/tienda/SolicitarTab.tsx`)
- **Formulario**: desplegable "Tipo de transferencia" → campos condicionales:
  - **Transferencia ARS**: obligatorios `CBU/CVU/Alias` (texto), `Monto ARS` (número > 0); opcionales `Nombre del beneficiario`, `CUIT/CUIL/DNI del beneficiario`.
  - **Transferencia USD**: obligatorios `Número de cuenta`, `Monto USD`, `Nombre completo del beneficiario`, `Domicilio completo`.
  - **Transferencia USDT**: obligatorios `Wallet cripto del beneficiario`, `Blockchain` (texto libre con sugerencias: TRC-20, ERC-20, BEP-20, Polygon), `Monto USDT`.
- Enviar → `POST /api/tienda/transferencias` `{tipo, datos}` → inserta `transfer_requests` (estado pendiente, created_by = email de sesión). Toast de éxito.
- **Debajo**: listado de solicitudes propias (`GET /api/tienda/transferencias`) con tipo, monto, fecha, estado (Pendiente ámbar / Pagada verde) y, si pagada: detalle del descuento aplicado + link al comprobante (URL firmada) si existe.

### 4.4 Pestaña 3 — "Buscar pagos" (`components/tienda/BuscarPagosTab.tsx`)
- **Formulario** (todos obligatorios): `Nombre y apellido`, `Monto exacto` (número), `Fecha y hora del pago` (datetime-local, ART).
- `POST /api/tienda/buscar-pago` `{nombre, monto, fechaHora}` → busca en `hot.unmatchedPayments` (TODOS, sin filtro de billetera):
  - Monto: igualdad exacta (`payment.monto === monto`).
  - Nombre: `nameSimilarity(nombre, payment.nombrePagador) >= 50` (importar de `lib/auto-match`, MISMO criterio que la señal verde de Nombre del emparejamiento).
  - Fecha: `|payment.fechaPago − fechaHora| <= 24h`.
  - Los 3 criterios simultáneos. 0 resultados → `{found: false}` → mensaje "No hay coincidencias con ese pago".
  - Devuelve TODOS los que coinciden (puede haber >1): `{found: true, pagos: [{mpPaymentId, monto, nombrePagador, fechaPago, billetera}]}`.
- **Resultado**: tarjeta por pago (estética de PaymentsListTab) con botón **"Reclamar pago"** → pide `N° de orden` → confirma → `POST /api/tienda/reclamar` (ya construido en F3). Manejar errores del server con mensaje claro (orden inexistente, ya pagada, pago ya usado).

### 4.5 Criterios de aceptación O1
- Usuario tienda entra → cae en `/tienda`, pestaña Balance abierta, ve SOLO su tienda.
- Balance refleja movimientos reales; selector de día filtra la tabla; columna Cotización muestra "Pendiente" (API aún no conectada).
- Solicitud de cada uno de los 3 tipos se crea con validación de obligatorios y aparece en el listado como Pendiente.
- Buscar pagos: los 3 criterios se exigen juntos; sin coincidencia → mensaje exacto; con coincidencia → tarjeta + reclamo end-to-end (contra F3).
- Un usuario tienda NO puede ver datos de otra tienda ni siquiera manipulando requests (probar con `?storeId=` ajeno → ignorado).
- Build limpio.

---

## 5. FASE F3 [FABLE] — Reclamar pago (lógica de riesgo, server)

### 5.1 `POST /api/tienda/buscar-pago` y `POST /api/tienda/reclamar`
`reclamar` recibe `{mpPaymentId, orderNumber}`. Flujo (calcado de `api/manual-match` + `api/buscar-orden`):
1. `resolveStoreScope` → storeId efectivo (tienda: el suyo; admin: explícito).
2. `acquireLock('tienda-reclamar')` — 409 amable si ocupado.
3. Buscar la orden por número EN ESA TIENDA: primero cache de órdenes; si no está, **directo a la plataforma sin límite de 48hs** (reusar la lógica de `api/buscar-orden` construida en `9e029b4`). No existe → 404 "La orden #N no existe en tu tienda".
4. Guards: `isOrderAlreadyPaid(orderId)` → 409 "Esa orden ya está registrada como pagada". `isPaymentAlreadyUsed(mpPaymentId)` → 409 "Ese pago ya fue utilizado". Pago sigue en cola (puede haberlo tomado el auto-match hace segundos) → 409.
5. Marcar pagada en TiendaNube/Shopify (`markOrderAsPaid`). Si falla la API de la plataforma → NO registrar, devolver error (mismo criterio conservador que manual-match).
6. Persistir: sacar de `unmatchedPayments`, push a `recentMatches`, `incrementPersistedMonthStats(hot, monto, 'emparejamiento')` ← **bucket automatizado, decisión del usuario**, `appendRegistroEntry` con `action:'manual_paid'`, `source:'tienda_buscar'`, `triggeredBy:'human'` y `customerName`/orden completos (el hook de F2 crea solo el movimiento de balance).
7. `auditMatch` con actor = email del usuario. `appendActivity` `'tienda_reclamo_pago'` (esto alimenta el feed informativo del admin).
8. saveHotState/saveLogs, release lock, devolver `{success, orderNumber, storeName}`.

### 5.2 Cálculo de descuentos (usado por O2, definirlo acá para que quede única fuente)
`lib/balance.ts → calcularDescuento(moneda, monto, tasas)`:
| Moneda retirada | Tasas obligatorias | ARS descontado | USDT descontado |
|---|---|---|---|
| `ARS` / `ARS_BILLETE` | `cotizacionUsdtArs` | `monto` | `monto / cotizacionUsdtArs` |
| `USDT` | `tasaUsdtArs` | `monto × tasaUsdtArs` | `monto` |
| `USD` / `USD_BILLETE` | `tasaUsdArs` y `tasaUsdUsdt` | `monto × tasaUsdArs` | `monto × tasaUsdUsdt` |
Movimiento egreso: `ars = −arsDescontado`, `usdt = −usdtDescontado`, `rate_source='manual'`, `ref_transfer_id`.

### 5.3 Criterios de aceptación F3
- Reclamo feliz end-to-end en local: pago sale de la cola, orden marcada en TN, registro con `source='tienda_buscar'`, movimiento de balance creado, stats del mes suman en bucket emparejado.
- Cada guard devuelve su error específico (orden inexistente / ya pagada / pago usado / lock).
- Doble reclamo simultáneo del mismo pago → uno gana, el otro 409 (probar con 2 requests paralelos).
- `calcularDescuento` con unit-check en script (`scripts/` o test inline) para las 5 monedas.

---

## 6. FASE O2 [OPUS] — Administración Financiera (`/finanzas`)

### 6.1 Navegación
- `app/page.tsx` header: agregar botón **"Administración Financiera"** (link a `/finanzas`) en la zona central del grid del header, estilo de los botones existentes.
- `/finanzas` (admin only — el middleware ya lo garantiza): mismo header, pero el botón dice **"Gestión de órdenes"** y vuelve a `/`.

### 6.2 Estructura `/finanzas` (`app/finanzas/page.tsx`)
- **Franja de tarjetas** (debajo del header): una tarjeta por tienda — nombre + balance **USDT** y **ARS** (de `GET /api/finanzas/balances`, una sola query `getBalances()`). Grid responsive (`flex-wrap`); se adapta sola al agregar/quitar tiendas porque itera `getStores()`.
- **Menú lateral izquierdo**: "Administración general" (default) + una entrada por tienda. Igual patrón visual de tabs pero vertical.
- **Panel derecho**: contenido de la pestaña activa.

### 6.3 Pestaña "Administración general" (`components/finanzas/AdminGeneralTab.tsx`)
- **Central de notificaciones** con dos secciones:
  1. **Solicitudes pendientes** (`GET /api/finanzas/solicitudes?estado=pendiente`): fila "**{tienda}** solicitó **{tipo legible}**" + fecha + botón **"Ver detalles"** → modal:
     - Todos los datos que mandó la tienda (render por tipo).
     - **Adjuntar comprobante** (opcional): input file → `POST /api/finanzas/comprobante` (multipart; sube a bucket `comprobantes`, path `transfer-{id}/{filename}`; devuelve path).
     - **"Descontar saldo a la tienda"**: select moneda (`USDT`, `USD`, `ARS`, `USD billete`, `ARS billete`) + monto + campos de tasa según §5.2 (obligatorios, validar > 0).
     - Vista previa en vivo del cálculo: "Se descontarán X ARS y Y USDT".
     - Botón "Confirmar pago" → `POST /api/finanzas/pagar-solicitud` `{id, moneda, monto, tasas, comprobantePath?}` → server: valida tasas con `calcularDescuento`, marca `estado='pagada'` (`paid_at/paid_by`), guarda `descuento` JSONB, crea movimiento egreso (`registrarEgresoTransferencia`). La solicitud desaparece de pendientes.
  2. **Reclamos de pagos (informativo)** (`GET /api/finanzas/reclamos`): entradas del registro `source='tienda_buscar'` de los últimos 7 días: "**{tienda}** se adjudicó un pago de **{$monto}** (orden #{n}) — {fecha}". Sin acciones, solo lectura.

### 6.4 Pestañas por tienda (vista espejo)
- Renderizar `<TiendaPortal storeId={s.storeId} storeName={s.storeName} admin />` — el MISMO componente de O1. Con `admin`, las rutas `/api/tienda/**` reciben `?storeId=` explícito (permitido solo para admin por `resolveStoreScope`). El admin puede: ver balance/registro, **crear solicitudes en nombre de la tienda**, buscar/reclamar pagos.

### 6.5 Criterios de aceptación O2
- Tarjetas de balance por tienda correctas y consistentes con el portal de cada tienda.
- Flujo completo: tienda solicita → aparece en Admin general → admin adjunta comprobante + descuenta con tasas → solicitud Pagada → balance de la tienda baja en ARS y USDT según §5.2 → la tienda ve el detalle y el comprobante (URL firmada).
- Cada moneda de descuento exige SUS tasas y calcula bien (5 casos).
- Reclamo de tienda aparece en el feed informativo.
- Vista espejo funcional al 100% (incluye crear solicitud como admin).
- Build limpio.

---

## 7. FASE O3 [OPUS] — Integración final y pulido
1. Botón "Administración Financiera" visible solo para admin (ya lo es por ruta, pero ocultar visualmente si algún día hay más roles).
2. `README.md` — sección nueva: arquitectura del portal, tablas, cómo dar de alta usuarios (`scripts/agregar-usuario.mjs`), cómo resetear 2FA, cómo cargar saldos iniciales, cómo conectar la API de cotización (un solo archivo: `lib/cotizacion.ts`) y correr `scripts/backfill-cotizaciones.mjs`.
3. Revisión de polling: `/tienda` y `/finanzas` refrescan balance/notificaciones cada 60s (mismo patrón `setInterval` de page.tsx; realtime opcional futuro).
4. Pasada de errores: toasts consistentes, estados de carga, empty states ("Sin movimientos este día", "No hay solicitudes pendientes").
5. Verificación manual end-to-end de los criterios de TODAS las fases + build + push (con OK del usuario).

---

## 8. Riesgos y cuidados (leer antes de programar)
1. **Cutover de auth es duro**: al deployar F1, el login viejo muere. Deployar F1 solo, probar en prod con el email admin, y recién después seguir. Mantener `AUTH_*` env vars hasta confirmar (por rollback vía revert).
2. **El middleware NO debe tocar webhooks/cron** — tienen su propia auth. Cualquier cambio en `proxy.ts` se prueba contra los 3 webhooks con secret malo (esperado 401 propio, no redirect).
3. **`saveHotState` hace merge concurrente** — el flujo de reclamo debe seguir el patrón de manual-match exacto (lock + write-then-verify) para no pisar al cron.
4. **No confiar NUNCA en storeId del cliente** para rol tienda (`resolveStoreScope` único punto).
5. **Balance nunca rompe registro**: el hook de F2 es best-effort con log de error; la fuente de verdad de ingresos es `registro_log` y se puede reconstruir (`ref_registro_id`).
6. **Next 16**: middleware = `proxy.ts` (convención renombrada). `@supabase/ssr` funciona pero verificar manejo de cookies en Edge runtime en local antes de asumir.
7. Los montos ARS usan `payment.monto` (lo que entró de verdad), no `order.total`.

## 9. Pendientes que dependen del usuario
- [ ] Checklist §2.5 (Google Cloud + Supabase Dashboard) — **bloquea F1 en producción** (en local se puede desarrollar con un proyecto Supabase de prueba o el mismo con redirect localhost).
- [ ] Lista de emails → rol → tienda.
- [ ] API de cotización USDT (cuando esté: conectar `lib/cotizacion.ts` + correr backfill).
- [ ] Saldos iniciales por tienda (cuando estén: `scripts/cargar-saldo-inicial.mjs`).
- [ ] Crear bucket privado `comprobantes` en Supabase Storage (o lo crea F2 por API con service key — preferido, queda en la migración de F2).

## 10. Orden de ejecución y modelo
| # | Fase | Modelo | Depende de |
|---|---|---|---|
| 1 | F1 Auth | **Fable 5** | Checklist §2.5 para probar OAuth real |
| 2 | F2 Datos | **Fable 5** | Migración SQL en Supabase |
| 3 | F3 Reclamo | **Fable 5** | F2 |
| 4 | O1 Portal Tienda | Opus 4.8 | F1+F2 (F3 para el botón reclamar) |
| 5 | O2 Finanzas | Opus 4.8 | F2+F3+O1 (reusa TiendaPortal) |
| 6 | O3 Integración | Opus 4.8 | Todo lo anterior |
