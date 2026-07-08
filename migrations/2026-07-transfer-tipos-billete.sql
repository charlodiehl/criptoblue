-- Agrega los tipos de solicitud "Recibir USD billete" y "Recibir ARS billete"
-- al CHECK de transfer_requests.tipo. Idempotente.
ALTER TABLE transfer_requests DROP CONSTRAINT IF EXISTS transfer_requests_tipo_check;
ALTER TABLE transfer_requests ADD CONSTRAINT transfer_requests_tipo_check
  CHECK (tipo IN ('ars','usd','usdt','usd_billete','ars_billete'));
