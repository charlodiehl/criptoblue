-- Adjudicación de pagos sujeta a confirmación del admin.
-- Cuando una tienda reclama un pago con un N° de orden que NO existe en su tienda,
-- la adjudicación queda 'pendiente' (ya suma al saldo) hasta que el admin la
-- 'confirmada' (queda firme) o la 'rechazada' (se revierte). Los reclamos con orden
-- real quedan con adjudicacion NULL (firmes de una, comportamiento de siempre).
ALTER TABLE registro_log
  ADD COLUMN IF NOT EXISTS adjudicacion TEXT
  CHECK (adjudicacion IS NULL OR adjudicacion IN ('pendiente','confirmada','rechazada'));

-- Índice parcial: solo las filas con estado de adjudicación (para el feed del admin).
CREATE INDEX IF NOT EXISTS registro_log_adjudicacion_idx
  ON registro_log (adjudicacion) WHERE adjudicacion IS NOT NULL;
