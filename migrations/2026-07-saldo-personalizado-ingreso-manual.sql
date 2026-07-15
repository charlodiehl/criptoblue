-- Saldo personalizado a una tienda: nuevo tipo de movimiento 'ingreso_manual'.
-- Cuenta en el saldo y en la base de comisión (igual que una orden), pero se muestra
-- en la sección de movimientos del extracto, no en la tabla de órdenes.
ALTER TABLE balance_movements DROP CONSTRAINT IF EXISTS balance_movements_tipo_check;
ALTER TABLE balance_movements ADD CONSTRAINT balance_movements_tipo_check
  CHECK (tipo IN ('ingreso_orden','egreso_transferencia','ajuste','reembolso','ingreso_manual'));

-- La base de comisión (ingreso_ars/usdt) ahora incluye 'ingreso_manual', para que el
-- saldo personalizado cobre la comisión de la tienda igual que una orden.
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
         COALESCE(SUM(ars)  FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual')), 0) AS ingreso_ars,
         COALESCE(SUM(usdt) FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual')), 0) AS ingreso_usdt
  FROM balance_movements
  GROUP BY store_id;
$$;
