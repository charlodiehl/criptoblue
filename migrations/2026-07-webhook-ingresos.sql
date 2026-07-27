-- ════════════════════════════════════════════════════════════════════════════
-- AUDITORÍA DE PAGOS ENTRANTES POR WEBHOOK
--
-- Registra TODA request que llega a un webhook de pagos (Notificador, Copter),
-- entre o no entre. Hasta ahora, los caminos que respondían 200 sin cargar el
-- pago —los dos chequeos de "duplicado"— no dejaban NINGÚN rastro: el que envía
-- ve un 200 y nosotros no tenemos con qué demostrar qué pasó. Eso es exactamente
-- lo que impidió explicar el pago de $203.916,22 del 27/07.
--
-- Dos fases, a propósito:
--   1. Al ENTRAR la request se inserta la fila con estado 'recibido' y el payload
--      crudo. Si la función se muere después (timeout, saturación, deploy en el
--      medio), la fila queda en 'recibido' — y eso mismo es la prueba de que el
--      problema fue nuestro.
--   2. Al TERMINAR se actualiza con el estado final, el motivo y cuánto tardó.
--
-- El payload crudo permite RECONSTRUIR un pago perdido sin pedirle nada a nadie.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS webhook_ingresos (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unidad          TEXT NOT NULL DEFAULT 'criptoblue',
  fuente          TEXT NOT NULL,              -- 'notificador' | 'copter'

  -- 'recibido'  → entró y todavía no terminó (si queda así, nos morimos procesando)
  -- 'aceptado'  → el pago se agregó a la cola
  -- 'duplicado' → ya estaba (en la cola o ya emparejado). NO es un error.
  -- 'ignorado'  → no era un pago (otro tipo de evento)
  -- 'rechazado' → datos inválidos o sin autorización
  -- 'error'     → excepción inesperada
  estado          TEXT NOT NULL DEFAULT 'recibido',
  motivo          TEXT,                       -- por qué, en castellano

  payment_id      TEXT,                       -- el id con el que se guarda (notificador-xxx)
  id_externo      TEXT,                       -- id_transaccion / messageId de quien envía
  monto           NUMERIC,
  titular         TEXT,
  fecha_operacion TIMESTAMPTZ,

  http_status     INT,
  duration_ms     INT,
  ip              TEXT,
  user_agent      TEXT,
  payload         JSONB,                      -- crudo: permite reconstruir el pago
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_ingresos DROP CONSTRAINT IF EXISTS webhook_ingresos_estado_check;
ALTER TABLE webhook_ingresos ADD CONSTRAINT webhook_ingresos_estado_check
  CHECK (estado IN ('recibido','aceptado','duplicado','ignorado','rechazado','error'));

ALTER TABLE webhook_ingresos DROP CONSTRAINT IF EXISTS webhook_ingresos_unidad_check;
ALTER TABLE webhook_ingresos ADD CONSTRAINT webhook_ingresos_unidad_check
  CHECK (unidad IN ('criptoblue','ms'));

-- La unidad va primera: es el filtro que lleva toda query (ver lib/unidad.ts).
CREATE INDEX IF NOT EXISTS idx_webhook_ingresos_unidad   ON webhook_ingresos (unidad, ts DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_ingresos_estado   ON webhook_ingresos (unidad, estado, ts DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_ingresos_externo  ON webhook_ingresos (id_externo);
CREATE INDEX IF NOT EXISTS idx_webhook_ingresos_payment  ON webhook_ingresos (payment_id);

NOTIFY pgrst, 'reload schema';
