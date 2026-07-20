-- ════════════════════════════════════════════════════════════════════════════
-- Rol "billetera": dueño de una billetera (como el rol 'tienda' para las tiendas).
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (o vía pg). Idempotente y aditivo:
-- el código viejo no lee las columnas nuevas, así que correrlo antes del deploy es seguro.
--
--   wallet             → a qué billetera pertenece el usuario (MF, Lacar, MS, …).
--   billetera_permiso  → 'editor' (puede retirar saldo) | 'lectura' (solo ver).
-- Un usuario 'billetera' exige ambos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('admin','tienda','billetera'));

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS wallet            TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS billetera_permiso TEXT;

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS billetera_permiso_check;
ALTER TABLE app_users ADD CONSTRAINT billetera_permiso_check
  CHECK (billetera_permiso IS NULL OR billetera_permiso IN ('editor','lectura'));

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS billetera_requiere_wallet;
ALTER TABLE app_users ADD CONSTRAINT billetera_requiere_wallet
  CHECK (role <> 'billetera' OR (wallet IS NOT NULL AND billetera_permiso IS NOT NULL));

-- Verificación:
-- SELECT email, role, store_id, wallet, billetera_permiso FROM app_users ORDER BY role;
