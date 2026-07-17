-- ════════════════════════════════════════════════════════════════════════════
-- Permisos por integrante dentro de cada tienda.
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (Dashboard → SQL Editor).
-- Idempotente.
--
-- Columna `permisos` (JSONB): { "administracion": bool, "solicitar_transferencias":
-- bool, "solicitar_reembolsos": bool }. Ausencia de clave = permiso NO otorgado.
-- Los usuarios 'admin' (super-admin del sistema) NO la usan: pueden todo por su rol.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Continuidad: los integrantes de tienda que ya existen podían usar todas las
-- pestañas. Se les otorgan todos los permisos (incluida Administración) para no
-- cortarles el acceso; el super-admin ajusta después quién queda como administrador.
-- Solo toca filas rol='tienda' que todavía no tienen permisos cargados.
UPDATE app_users
   SET permisos = '{"administracion":true,"solicitar_transferencias":true,"solicitar_reembolsos":true}'::jsonb
 WHERE role = 'tienda'
   AND (permisos IS NULL OR permisos = '{}'::jsonb);

-- Verificación:
-- SELECT email, role, store_id, permisos FROM app_users ORDER BY store_id;
