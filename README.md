This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# criptoblue

---

# Portal de Tiendas + Administración Financiera

Sistema multi-rol sobre la app de conciliación. Plan y decisiones completas en
[`PLAN-PORTAL-FINANZAS.md`](./PLAN-PORTAL-FINANZAS.md).

## Roles y acceso

- **Autenticación:** Google OAuth + 2FA TOTP obligatorio (Supabase Auth). No hay
  usuario/contraseña.
- **Roles** (tabla `app_users`, carga manual): `admin` (ve todo: gestión de
  órdenes + Administración Financiera) y `tienda` (solo su portal en `/tienda`).
- Un email que se loguea sin fila en `app_users` queda **bloqueado** (pantalla
  "No tenés permiso para acceder").
- El middleware (`proxy.ts`) exige sesión + rol + AAL2 (2FA verificado). Las
  rutas `/api/**` re-verifican server-side con `requireUser()` (revocación
  inmediata al sacar la fila de `app_users`).

## Puesta en marcha (una vez)

1. **Migración SQL:** ejecutar `migrations/2026-07-portal-finanzas.sql` en el
   SQL Editor de Supabase (crea `app_users`, `transfer_requests`,
   `balance_movements` + RPC de balances + RLS). Es idempotente.
2. **Setup:** `node scripts/setup-portal.mjs` (crea el bucket privado
   `comprobantes` y verifica que las 3 tablas respondan).
3. **Google/Supabase Auth:** ver §2.5 del plan (credencial OAuth en Google Cloud,
   habilitar provider Google + TOTP en Supabase, configurar Redirect URLs).
4. **Alta del primer admin:** `node scripts/agregar-usuario.mjs <tu-email> admin`.

## Operación diaria (scripts)

- **Dar de alta un usuario:**
  - `node scripts/agregar-usuario.mjs <email> admin`
  - `node scripts/agregar-usuario.mjs <email> tienda <storeId> ["Nombre"]`
  - `node scripts/agregar-usuario.mjs --listar` / `--borrar <email>`
  - El `storeId` es el id de la tienda en `criptoblue:stores` (el script valida
    que exista y lista las disponibles si te equivocás).
- **Resetear 2FA** (si alguien pierde el teléfono):
  `node scripts/reset-mfa.mjs <email>` → en su próximo login vuelve a configurarlo.
- **Cargar saldo inicial de una tienda:**
  `node scripts/cargar-saldo-inicial.mjs <storeId> <ars> <usdt> ["desc"]`
  (los balances arrancan en 0; esto agrega un movimiento `ajuste`).

## Conectar una tienda Shopify

Shopify obliga a **una app por tienda**: se crea con *Custom distribution*, que la ata
a un dominio concreto. Usar la app de una tienda en otra da
*"The installation link for this app is invalid"*.

1. **Partner Dashboard** (partners.shopify.com) → **Apps → Create app**
   (ej. "Automatización \<Tienda\>").
2. **Configuration** — los valores tienen que ser EXACTOS:
   - **App URL:** `https://criptoblue.vercel.app/`
   - **Allowed redirection URL(s):** `https://criptoblue.vercel.app/api/shopify/callback`
     — el código la arma como `<origin>/api/shopify/callback` (`api/shopify/connect`);
     si no coincide, Shopify rechaza el OAuth.
   - **Scopes:** `read_orders,write_orders,read_customers` (= `CONFIG.shopify.scopes`).
     Si quedan vacíos, la app se instala sin permisos.
   - *Embed app in Shopify admin:* NO. *Webhooks API version:* da igual — la app lee
     las órdenes por API y no recibe webhooks de Shopify.
3. **Distribution → Custom distribution** → el dominio de la tienda
   (`<handle>.myshopify.com`; el handle sale de `admin.shopify.com/store/<handle>/`).
   Sin esto, la instalación falla.
4. **Client ID / Client secret** de la app → variables de Vercel
   `CRIPTOBLUE_SHOPIFY_CLIENT_ID` y `CRIPTOBLUE_SHOPIFY_CLIENT_SECRET` → **redeploy**
   (sin redeploy sigue usando las de la app anterior).
5. **Instalar**: abrir el link de *Generate link* → Install.
6. **Conectar en CriptoBlue**: 🏪 Tiendas → Agregar tienda → Shopify → el handle
   (acepta `<handle>` o `<handle>.myshopify.com`).

**El paso 6 no se puede saltear:** el link de Shopify instala la app pero trae
`no_redirect=true` y no pasa por `/api/shopify/callback`, que es donde se intercambia
el `code` por el **access token** y se guarda la tienda. Sin eso, la app queda instalada
pero CriptoBlue no tiene con qué leerla.

**Pisar esas env NO rompe las tiendas ya conectadas:** el `client_id`/`secret` se usan
sólo durante la conexión; después cada tienda opera con su propio `accessToken` guardado
en `criptoblue:stores`. Por eso se van pisando con la app de cada tienda nueva.

**Verificar que quedó bien** (con el `accessToken` de `criptoblue:stores`, header
`X-Shopify-Access-Token`): `GET https://<handle>.myshopify.com/admin/api/2026-01/shop.json`
y `…/orders.json?limit=3&status=any` (prueba el scope `read_orders`).

## Cotización del USDT

- **Fuente:** precio de **venta** de Binance P2P (`bid`) vía CriptoYa
  (`https://criptoya.com/api/binancep2p/USDT/ARS/1`) **+ 0,75%** de margen. Es la
  misma cotización para todas las tiendas y todas las órdenes.
  Único punto de configuración: `lib/cotizacion.ts` (`getUsdtRate` + `MARGEN_VENTA`).
- **Al emparejar una orden:** el ingreso toma la cotización actual (con cache de 2
  min). Si la API está caída en ese instante, el movimiento queda `rate_source =
  'pendiente'` (`usdt = NULL`) y la UI muestra **"Pendiente"**.
- **Backfill automático:** el cron `/api/cron/cotizaciones` corre **cada 10 min**
  (ver `vercel.json`) y completa TODOS los movimientos `pendiente` con la
  cotización actual. Se protege con `CRON_SECRET` (igual que `/api/run`).
- **Backfill manual:** `node scripts/backfill-cotizaciones.mjs [--dry]` hace lo mismo
  a demanda.

## Flujos

- **Balance de una tienda** = `SUM(ars)` y `SUM(usdt)` de `balance_movements`
  (ingresos +, egresos −). Los ingresos los crea automáticamente el registro de
  cada orden pagada (hook en `lib/registro.ts`, best-effort). Los egresos los crea
  el admin al pagar una solicitud de transferencia.
- **Solicitar transferencia** (tienda) → **pagar** (admin, con moneda + tasas +
  comprobante opcional). El descuento se calcula en `lib/balance.ts`
  (`calcularDescuento`) — tasas obligatorias según la moneda retirada.
- **Buscar/Reclamar pago** (tienda): busca en la cola de pendientes por monto
  exacto + nombre parcial + ±24h; al reclamar valida la orden en TiendaNube/Shopify
  y la registra (cuenta como volumen emparejado).
- **Vista espejo del admin:** en `/finanzas`, cada tienda tiene una pestaña que
  reusa el componente `TiendaPortal` con `admin` — el admin opera como la tienda.
