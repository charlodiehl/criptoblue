-- ════════════════════════════════════════════════════════════════════════════
-- Preferencias de notificaciones push — una fila por usuario (admin).
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (Dashboard → SQL Editor).
-- Idempotente (IF NOT EXISTS). Tabla nueva: no toca nada existente.
--
-- prefs: JSON { "<evento>": true|false }. La AUSENCIA de una clave = ACTIVADO
-- (al prender las notificaciones llegan todas, hasta que se apague un grupo).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_email  TEXT PRIMARY KEY,              -- SIEMPRE lowercase (= app_users.email)
  prefs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS deny-all: solo el server (service key) accede. La anon key nunca las lee.
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

-- Verificación:
-- SELECT tablename FROM pg_tables WHERE tablename = 'notification_prefs';
