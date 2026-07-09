-- La RPC de balances ahora también devuelve la BASE DE INGRESOS por tienda
-- (suma de los movimientos 'ingreso_orden'), para poder calcular la comisión
-- sobre las órdenes (no sobre egresos/ajustes). Cambia el tipo de retorno → DROP.
DROP FUNCTION IF EXISTS balances_tiendas();
CREATE OR REPLACE FUNCTION balances_tiendas()
RETURNS TABLE(
  store_id TEXT, ars NUMERIC, usdt NUMERIC, pendientes BIGINT,
  ingreso_ars NUMERIC, ingreso_usdt NUMERIC
)
LANGUAGE SQL STABLE AS $$
  SELECT store_id,
         COALESCE(SUM(ars), 0)  AS ars,
         COALESCE(SUM(usdt), 0) AS usdt,
         COUNT(*) FILTER (WHERE rate_source = 'pendiente') AS pendientes,
         COALESCE(SUM(ars)  FILTER (WHERE tipo = 'ingreso_orden'), 0) AS ingreso_ars,
         COALESCE(SUM(usdt) FILTER (WHERE tipo = 'ingreso_orden'), 0) AS ingreso_usdt
  FROM balance_movements
  GROUP BY store_id;
$$;
