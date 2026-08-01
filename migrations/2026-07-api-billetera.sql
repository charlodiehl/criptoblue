-- ─────────────────────────────────────────────────────────────────────────────
-- API pública de BILLETERA (GET /api/v1/billetera), espejo de la de tiendas.
--
-- Se reusa la tabla store_api_keys en vez de crear una nueva: una key es de UNA
-- tienda o de UNA billetera, nunca de las dos, y todo lo demás (hash, prefijo,
-- revocación, último uso, unidad, rate limit sobre api_audit_log) es idéntico.
-- Duplicar la tabla habría duplicado también validarApiKey, el rate limit y el
-- audit log, que es justo donde no conviene tener dos implementaciones.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE store_api_keys ADD COLUMN IF NOT EXISTS wallet TEXT;

-- store_id deja de ser obligatorio: las keys de billetera no tienen tienda.
ALTER TABLE store_api_keys ALTER COLUMN store_id DROP NOT NULL;

-- Exactamente uno de los dos. Sin esto se podría crear una key sin dueño (que no
-- serviría para nada) o con dos (y el endpoint no sabría a qué acotar).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_api_keys_dueno_unico'
  ) THEN
    ALTER TABLE store_api_keys ADD CONSTRAINT store_api_keys_dueno_unico
      CHECK ((store_id IS NOT NULL AND wallet IS NULL)
          OR (store_id IS NULL AND wallet IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_store_api_keys_wallet ON store_api_keys(unidad, wallet);

-- El audit log guarda a quién pertenecía la key de cada request.
ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS wallet TEXT;

-- RLS ya está activo en las dos tablas y sin políticas (solo service role).
