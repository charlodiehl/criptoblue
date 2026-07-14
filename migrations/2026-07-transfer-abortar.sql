-- Abortar solicitudes de transferencia: el admin puede rechazar una solicitud
-- pendiente. Amplía el CHECK de transfer_requests.estado para incluir 'rechazada'
-- (refund_requests.estado ya lo permitía). Idempotente. No toca datos existentes.
ALTER TABLE transfer_requests DROP CONSTRAINT IF EXISTS transfer_requests_estado_check;
ALTER TABLE transfer_requests ADD CONSTRAINT transfer_requests_estado_check
  CHECK (estado IN ('pendiente','pagada','rechazada'));
