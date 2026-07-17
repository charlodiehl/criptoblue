-- ════════════════════════════════════════════════════════════════════════════
-- Saldo personalizado SIN comisión (checkbox "no se cobra comisión").
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar ENTERO en la consola SQL de Supabase (Dashboard → SQL Editor).
-- Idempotente. No cambia ningún saldo existente: la columna arranca en false,
-- que es el comportamiento actual (todo saldo personalizado cobra comisión).
--
-- La comisión NO se guarda: se calcula al leer, sobre la "base gravada". Por eso,
-- para que un movimiento no cobre comisión hay que marcarlo y sacarlo de esa base:
--   • saldo TOTAL  → RPC balances_tiendas (ingreso_ars/ingreso_usdt), acá abajo
--   • saldo del DÍA → getBalanceDia en lib/balance.ts (esGravado)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE balance_movements
  ADD COLUMN IF NOT EXISTS sin_comision BOOLEAN NOT NULL DEFAULT false;

-- La base de comisión excluye los movimientos marcados sin_comision. El saldo
-- (SUM(usdt)) los sigue incluyendo: entra la plata, pero no se cobra comisión.
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
         COALESCE(SUM(ars)  FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual') AND NOT sin_comision), 0) AS ingreso_ars,
         COALESCE(SUM(usdt) FILTER (WHERE tipo IN ('ingreso_orden','ingreso_manual') AND NOT sin_comision), 0) AS ingreso_usdt
  FROM balance_movements
  GROUP BY store_id;
$$;

-- Verificación:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='balance_movements' AND column_name='sin_comision';
