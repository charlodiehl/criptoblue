-- API pública de registro por tienda (GET /api/v1/registro).
-- Dos tablas: keys por tienda (hasheadas) y log de auditoría (también sirve de
-- contador para el rate limit).

-- ─── Keys por tienda ──────────────────────────────────────────────────────────
-- La key en texto plano se entrega UNA vez al generarla; en la DB solo vive el
-- hash SHA-256. Una tienda puede tener varias (rotación). revoked_at = deshabilitada.
CREATE TABLE IF NOT EXISTS store_api_keys (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id     text        NOT NULL,
  key_hash     text        NOT NULL UNIQUE,   -- SHA-256 hex de la key
  key_prefix   text,                          -- primeros chars (para identificarla en logs, no es secreto)
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_store_api_keys_store ON store_api_keys(store_id);

-- ─── Log de auditoría ─────────────────────────────────────────────────────────
-- Una fila por request (haya salido bien o mal). El rate limit cuenta las filas de
-- una key en los últimos 60s desde acá mismo.
CREATE TABLE IF NOT EXISTS api_audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  store_id       text,
  key_id         bigint,
  endpoint       text,
  desde          date,
  hasta          date,
  status         int,
  error          text,
  ip             text,
  user_agent     text,
  duration_ms    int,
  dias_devueltos int
);
CREATE INDEX IF NOT EXISTS idx_api_audit_key_ts ON api_audit_log(key_id, ts DESC);

-- RLS: ambas tablas son de acceso SOLO server-side (service role, que bypassa RLS).
-- Con RLS activado y SIN políticas, la anon key y cualquier JWT de usuario quedan
-- denegados vía PostgREST — nadie puede leer los hashes ni el log desde el cliente.
ALTER TABLE store_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_audit_log  ENABLE ROW LEVEL SECURITY;
