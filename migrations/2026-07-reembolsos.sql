-- ════════════════════════════════════════════════════════════════════════════
-- Reembolsos — tablas nuevas + tipo 'reembolso' en balance_movements
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (o vía pg). Idempotente.
-- Tablas nuevas (no tocan datos existentes). El ALTER del CHECK de
-- balance_movements solo AMPLÍA los valores permitidos → no rompe filas viejas.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Reembolsos EJECUTADOS (ledger: tope acumulado + numeración "(2)", "(3)"…)
CREATE TABLE IF NOT EXISTS refunds (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id         TEXT NOT NULL,
  order_number     TEXT NOT NULL,
  order_id         TEXT,
  order_total      NUMERIC,               -- snapshot del total de la orden al reembolsar
  monto            NUMERIC NOT NULL,      -- ARS reembolsado (positivo)
  usdt             NUMERIC,               -- USDT descontado (positivo)
  cotizacion       NUMERIC,               -- ARS por 1 USDT (manual)
  wallet           TEXT,                  -- billetera de la que vino el pago (se le resta el reembolso)
  seq              INT NOT NULL DEFAULT 1, -- 1,2,3… por (store, orden)
  comprobante_path TEXT NOT NULL,         -- OBLIGATORIO (bucket 'comprobantes')
  request_id       BIGINT,                -- FK lógica a refund_requests.id (si vino de una solicitud)
  ref_movement_id  BIGINT,                -- FK lógica a balance_movements.id
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx  ON refunds (store_id, order_number);
CREATE INDEX IF NOT EXISTS refunds_wallet_idx ON refunds (wallet) WHERE wallet IS NOT NULL;

-- 2) SOLICITUDES de reembolso hechas por las tiendas (llegan al panel del admin)
CREATE TABLE IF NOT EXISTS refund_requests (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id         TEXT NOT NULL,
  order_number     TEXT NOT NULL,
  order_id         TEXT,
  order_total      NUMERIC,
  monto_solicitado NUMERIC,               -- lo que propone la tienda (el admin decide el final)
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesada','rechazada')),
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,
  processed_by     TEXT
);
CREATE INDEX IF NOT EXISTS refund_requests_estado_idx ON refund_requests (estado) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS refund_requests_store_idx  ON refund_requests (store_id, created_at DESC);

-- 3) Ampliar el CHECK de balance_movements.tipo para incluir 'reembolso'
ALTER TABLE balance_movements DROP CONSTRAINT IF EXISTS balance_movements_tipo_check;
ALTER TABLE balance_movements ADD CONSTRAINT balance_movements_tipo_check
  CHECK (tipo IN ('ingreso_orden','egreso_transferencia','ajuste','reembolso'));

-- 4) RLS deny-all: solo el server (service key) accede a estas tablas
ALTER TABLE refunds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

-- Verificación rápida (debe listar las 2 tablas):
-- SELECT tablename FROM pg_tables WHERE tablename IN ('refunds','refund_requests');
