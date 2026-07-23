-- Feature "Concepto": etiqueta opcional por movimiento de tienda.
-- Se guarda donde el usuario la ingresa. El resto (Ventas / Reembolso) se deriva; el
-- ajuste va sin concepto. La lista de conceptos por tienda vive en kv_store
-- (criptoblue:conceptos:<storeId>), no necesita tabla.
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS concepto text;
ALTER TABLE registro_log      ADD COLUMN IF NOT EXISTS concepto text;
