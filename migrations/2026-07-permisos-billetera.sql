-- ════════════════════════════════════════════════════════════════════════════
-- PERMISOS POR INTEGRANTE DE BILLETERA
--
-- Reemplaza el par binario editor/lectura (columna billetera_permiso) por el mismo
-- modelo que ya usan las tiendas: un JSONB con permisos sueltos.
--   administracion    → gestiona el equipo de la billetera (implica todos)
--   registrar_retiros → puede anotar retiros de saldo   (equivale al viejo 'editor')
--   ver_saldo         → ve los montos; sin esto los ve tapados (***)
--
-- billetera_permiso NO se borra todavía: queda como respaldo mientras convivan las
-- dos versiones del código durante el deploy. El backfill (scripts/backfill-permisos-
-- billetera.mjs) llena la columna nueva ANTES de deployar, así nadie pierde acceso
-- en el momento del cambio.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS billetera_permisos JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
