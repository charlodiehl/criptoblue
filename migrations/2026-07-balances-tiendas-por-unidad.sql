-- ════════════════════════════════════════════════════════════════════════════
-- balances_tiendas() acotada a una unidad de negocio.
--
-- Es la ÚNICA lectura de datos que no pasa por el cliente de lib/storage (es un
-- RPC), así que el proxy que acota por unidad no la alcanza: hay que filtrarla
-- acá adentro. Sin esto, cada unidad veía los saldos de todas las tiendas.
--
-- El parámetro NO tiene default a propósito: si alguien la llama sin unidad, que
-- falle, en vez de devolver los saldos de todo el mundo (mismo criterio
-- fail-closed que getUnidad() en lib/unidad.ts).
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS balances_tiendas();
DROP FUNCTION IF EXISTS balances_tiendas(TEXT);

CREATE OR REPLACE FUNCTION balances_tiendas(p_unidad TEXT)
RETURNS TABLE(
  store_id TEXT, ars NUMERIC, usdt NUMERIC, pendientes BIGINT,
  ingreso_ars NUMERIC, ingreso_usdt NUMERIC
)
LANGUAGE SQL STABLE AS $$
  SELECT store_id,
         COALESCE(SUM(ars), 0)  AS ars,
         COALESCE(SUM(usdt), 0) AS usdt,
         COUNT(*) FILTER (WHERE rate_source = 'pendiente') AS pendientes,
         COALESCE(SUM(ars)  FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual') AND NOT sin_comision), 0) AS ingreso_ars,
         COALESCE(SUM(usdt) FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual') AND NOT sin_comision), 0) AS ingreso_usdt
  FROM balance_movements
  WHERE unidad = p_unidad
  GROUP BY store_id;
$$;

NOTIFY pgrst, 'reload schema';
