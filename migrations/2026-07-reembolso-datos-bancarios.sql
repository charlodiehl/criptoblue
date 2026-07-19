-- ════════════════════════════════════════════════════════════════════════════
-- Datos bancarios en la solicitud de reembolso de la tienda
-- ════════════════════════════════════════════════════════════════════════════
-- La tienda ahora manda a dónde quiere que le devuelvan la plata: alias o CBU
-- (obligatorio en la app) y, opcionalmente, el nombre del titular de esa cuenta.
-- El admin los ve al procesar la solicitud.
--
-- Aditiva y idempotente: columnas nullable, no toca datos existentes. Las
-- solicitudes viejas quedan en NULL y la UI las muestra como "no informado".
--
-- ⚠️ CORRER ESTO ANTES DE DESPLEGAR el código que las escribe.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS alias_cbu text;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS titular   text;
