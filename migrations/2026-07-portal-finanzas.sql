-- ════════════════════════════════════════════════════════════════════════════
-- Portal de tiendas + Administración financiera — tablas nuevas
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (Dashboard → SQL Editor).
-- Es idempotente (IF NOT EXISTS): correrlo dos veces no rompe nada.
-- Son tablas nuevas: no tocan registro_log ni kv_store, y el código viejo no
-- las usa — se pueden crear en cualquier momento antes del deploy.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Usuarios de la app (carga manual — ver scripts/agregar-usuario.mjs)
CREATE TABLE IF NOT EXISTS app_users (
  email        TEXT PRIMARY KEY,             -- SIEMPRE lowercase
  role         TEXT NOT NULL CHECK (role IN ('admin','tienda')),
  store_id     TEXT,                         -- id de la tienda (criptoblue:stores) — obligatorio si role='tienda'
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tienda_requiere_store CHECK (role <> 'tienda' OR store_id IS NOT NULL)
);

-- 2) Solicitudes de transferencia de las tiendas
CREATE TABLE IF NOT EXISTS transfer_requests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ars','usd','usdt')),
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada')),
  datos       JSONB NOT NULL,                -- campos del formulario según tipo
  created_by  TEXT NOT NULL,                 -- email del solicitante
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at     TIMESTAMPTZ,
  paid_by     TEXT,                          -- email del admin que pagó
  comprobante_path TEXT,                     -- path en el bucket 'comprobantes'
  descuento   JSONB                          -- {moneda, monto, tasas..., arsDescontado, usdtDescontado}
);
CREATE INDEX IF NOT EXISTS transfer_requests_store_idx  ON transfer_requests (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_requests_estado_idx ON transfer_requests (estado) WHERE estado = 'pendiente';

-- 3) Movimientos de balance (libro mayor por tienda)
--    Balance de una tienda = SUM(ars) y SUM(usdt) de sus movimientos.
--    usdt NULL = cotización pendiente (la API de cotización aún no estaba
--    conectada) → se completa después con scripts/backfill-cotizaciones.mjs.
CREATE TABLE IF NOT EXISTS balance_movements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ingreso_orden','egreso_transferencia','ajuste')),
  fecha       TIMESTAMPTZ NOT NULL,          -- momento del hecho (emparejamiento / pago / ajuste)
  ars         NUMERIC NOT NULL,              -- SIGNADO: ingresos +, egresos −
  usdt        NUMERIC,                       -- SIGNADO; NULL = cotización pendiente
  usdt_rate   NUMERIC,                       -- cotización ARS por 1 USDT usada
  rate_source TEXT NOT NULL DEFAULT 'pendiente' CHECK (rate_source IN ('api','manual','pendiente')),
  ref_registro_id BIGINT,                    -- FK lógica a registro_log.id (ingresos)
  ref_transfer_id BIGINT,                    -- FK lógica a transfer_requests.id (egresos)
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS balance_movements_store_idx    ON balance_movements (store_id, fecha DESC);
CREATE INDEX IF NOT EXISTS balance_movements_pend_idx     ON balance_movements (rate_source) WHERE rate_source = 'pendiente';
CREATE INDEX IF NOT EXISTS balance_movements_registro_idx ON balance_movements (ref_registro_id) WHERE ref_registro_id IS NOT NULL;

-- 4) Balance agregado de todas las tiendas en una sola llamada (RPC)
CREATE OR REPLACE FUNCTION balances_tiendas()
RETURNS TABLE(store_id TEXT, ars NUMERIC, usdt NUMERIC, pendientes BIGINT)
LANGUAGE SQL STABLE AS $$
  SELECT store_id,
         COALESCE(SUM(ars), 0)  AS ars,
         COALESCE(SUM(usdt), 0) AS usdt,
         COUNT(*) FILTER (WHERE rate_source = 'pendiente') AS pendientes
  FROM balance_movements
  GROUP BY store_id;
$$;

-- 5) RLS deny-all: estas tablas se acceden SOLO desde el server con service key
--    (la anon key del frontend no debe poder leerlas jamás).
ALTER TABLE app_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_movements ENABLE ROW LEVEL SECURITY;

-- Verificación rápida (debe listar las 3 tablas):
-- SELECT tablename FROM pg_tables WHERE tablename IN ('app_users','transfer_requests','balance_movements');
