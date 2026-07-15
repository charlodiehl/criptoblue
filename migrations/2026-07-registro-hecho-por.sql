-- Trazabilidad: guardar qué admin cargó/editó un pago a mano. Columna nullable
-- (null = pago automático o carga previa a esta feature). Aditiva, no toca datos.
ALTER TABLE registro_log ADD COLUMN IF NOT EXISTS hecho_por text;
