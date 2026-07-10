-- Salidas de billetera (retiros y transferencias).
--
-- Hasta ahora el saldo de una billetera era solo ingresos − comisión − reembolsos:
-- no había forma de registrar que se retiró plata. Las tiendas ya tienen ese flujo
-- (transfer_requests → balance_movements), pero está atado a store_id y el saldo de
-- tienda vive en USDT. El de billetera vive en ARS, así que necesita su propio libro.
--
-- Idempotente: se puede correr más de una vez.

-- 1) transfer_requests pasa a servir a tiendas O a billeteras (exactamente una).
ALTER TABLE transfer_requests ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS wallet TEXT;

ALTER TABLE transfer_requests DROP CONSTRAINT IF EXISTS transfer_requests_destino_check;
ALTER TABLE transfer_requests ADD CONSTRAINT transfer_requests_destino_check
  CHECK (
    (store_id IS NOT NULL AND wallet IS NULL) OR
    (store_id IS NULL     AND wallet IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS transfer_requests_wallet_idx
  ON transfer_requests (wallet, created_at DESC) WHERE wallet IS NOT NULL;

-- 2) Libro de salidas por billetera. Todo en ARS, que es la moneda del saldo.
--    `ars` es POSITIVO y representa cuánto SALE de la billetera (igual convención
--    que refunds.monto, del que ya se resta). No se usa signo, para no repetir el
--    error de balance_movements donde el signo vive en el dato.
CREATE TABLE IF NOT EXISTS wallet_movements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('transferencia_ars','usd_billete','ajuste')),
  fecha       TIMESTAMPTZ NOT NULL,            -- momento real del retiro
  ars         NUMERIC NOT NULL CHECK (ars > 0),-- POSITIVO: lo que sale
  usd         NUMERIC,                         -- solo en usd_billete
  usd_rate    NUMERIC,                         -- ARS por 1 USD, solo en usd_billete
  motivo      TEXT NOT NULL,
  ref_transfer_id BIGINT,                      -- FK lógica a transfer_requests.id
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_movements_wallet_idx ON wallet_movements (wallet, fecha DESC);

-- usd/usd_rate son obligatorios cuando el retiro es en billete, y solo entonces.
ALTER TABLE wallet_movements DROP CONSTRAINT IF EXISTS wallet_movements_usd_check;
ALTER TABLE wallet_movements ADD CONSTRAINT wallet_movements_usd_check
  CHECK (
    (tipo = 'usd_billete' AND usd IS NOT NULL AND usd_rate IS NOT NULL) OR
    (tipo <> 'usd_billete')
  );

-- 3) RLS deny-all: solo el server (service key) toca esta tabla, igual que
--    app_users, balance_movements y push_subscriptions.
ALTER TABLE wallet_movements ENABLE ROW LEVEL SECURITY;
