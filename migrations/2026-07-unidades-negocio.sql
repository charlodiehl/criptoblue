-- ─────────────────────────────────────────────────────────────────────────────
-- UNIDADES DE NEGOCIO — separación de datos entre 'criptoblue' y 'ms'.
--
-- Toda tabla de negocio lleva una columna `unidad`. El default 'criptoblue' hace
-- que TODO lo que ya existe quede en la unidad original sin backfill ni downtime,
-- y que cualquier insert viejo que se escape del proxy caiga donde estaba.
--
-- El filtro NO se aplica acá con RLS: la app usa la service key (que se saltea RLS).
-- Se aplica en lib/storage.ts, con un proxy sobre getClient() que le mete el
-- .eq('unidad', …) a las lecturas y el valor a las escrituras. Ver lib/unidad.ts.
--
-- kv_store no lleva columna: sus keys ya vienen prefijadas ('criptoblue:…' / 'ms:…').
-- push_subscriptions y notification_prefs tampoco: son del usuario, y el usuario
-- pertenece a una sola unidad.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app_users          ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE registro_log       ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE balance_movements  ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE wallet_movements   ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE refunds            ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE refund_requests    ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE transfer_requests  ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE store_api_keys     ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';
ALTER TABLE api_audit_log      ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'criptoblue';

-- Solo unidades conocidas. Si mañana se agrega una tercera, se amplía el CHECK
-- junto con UNIDADES de lib/unidad.ts.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_users','registro_log','balance_movements','wallet_movements',
                           'refunds','refund_requests','transfer_requests','store_api_keys','api_audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_unidad_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (unidad IN (''criptoblue'',''ms''))', t, t || '_unidad_check');
  END LOOP;
END $$;

-- La unidad va PRIMERA en cada índice: es el filtro que ahora lleva toda query.
CREATE INDEX IF NOT EXISTS idx_registro_log_unidad      ON registro_log      (unidad, ts DESC);
CREATE INDEX IF NOT EXISTS idx_balance_movements_unidad ON balance_movements (unidad, store_id, fecha);
CREATE INDEX IF NOT EXISTS idx_wallet_movements_unidad  ON wallet_movements  (unidad, wallet, fecha);
CREATE INDEX IF NOT EXISTS idx_refunds_unidad           ON refunds           (unidad, store_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_unidad   ON refund_requests   (unidad, store_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_unidad ON transfer_requests (unidad, store_id);
CREATE INDEX IF NOT EXISTS idx_store_api_keys_unidad    ON store_api_keys    (unidad, store_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_log_unidad     ON api_audit_log     (unidad, ts DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_unidad         ON app_users         (unidad);

NOTIFY pgrst, 'reload schema';
