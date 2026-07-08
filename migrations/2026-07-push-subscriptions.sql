-- ════════════════════════════════════════════════════════════════════════════
-- Suscripciones Web Push (PWA) — una por usuario y navegador/dispositivo.
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (Dashboard → SQL Editor).
-- Idempotente (IF NOT EXISTS). Tabla nueva: no toca nada existente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email  TEXT NOT NULL,                 -- SIEMPRE lowercase (= app_users.email)
  endpoint    TEXT NOT NULL,                 -- URL única del push service (Google/Mozilla/Apple)
  p256dh      TEXT NOT NULL,                 -- clave de encriptación de la suscripción
  auth        TEXT NOT NULL,                 -- token de autenticación de la suscripción
  user_agent  TEXT,                          -- para identificar el dispositivo
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una suscripción por (usuario, endpoint): el upsert la refresca en vez de duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_user_endpoint
  ON push_subscriptions (user_email, endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_email_idx
  ON push_subscriptions (user_email);

-- RLS deny-all: solo el server (service key) accede. La anon key nunca debe leerlas.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Verificación:
-- SELECT tablename FROM pg_tables WHERE tablename = 'push_subscriptions';
