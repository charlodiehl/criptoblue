-- Multi-acceso: un mismo usuario (email) puede tener acceso a varias tiendas y/o
-- billeteras. El acceso PRIMARIO sigue en las columnas de siempre (role + store_id
-- o wallet/billetera_permiso). Los accesos EXTRA van en este array:
--   [{ "tipo": "tienda"|"billetera", "id": "<storeId|wallet>",
--      "billeteraPermiso": "editor"|"lectura"|null, "permisos": {...}|null }]
-- Con 0 extras el usuario funciona igual que ahora (un solo acceso).
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS accesos_extra JSONB NOT NULL DEFAULT '[]'::jsonb;
