-- Las billeteras pasan a soportar los MISMOS 5 tipos de retiro que las tiendas
-- (ars, usd, usdt, usd_billete, ars_billete), no solo dos.
--
-- El saldo de billetera vive en ARS, así que un retiro en USD o USDT necesita una
-- cotización para descontarse. Se generalizan las columnas usd/usd_rate, que solo
-- servían al caso "USD billete":
--     usd       → monto_origen   (el monto en la moneda del retiro)
--     usd_rate  → cotizacion     (ARS por 1 unidad de esa moneda)
--   + moneda    (ARS | USD | USDT)
--
-- Idempotente: se puede correr más de una vez.

-- 1) Renombrar las columnas si todavía tienen el nombre viejo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='wallet_movements' AND column_name='usd') THEN
    ALTER TABLE wallet_movements RENAME COLUMN usd TO monto_origen;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='wallet_movements' AND column_name='usd_rate') THEN
    ALTER TABLE wallet_movements RENAME COLUMN usd_rate TO cotizacion;
  END IF;
END $$;

ALTER TABLE wallet_movements ADD COLUMN IF NOT EXISTS moneda TEXT;

-- 2) Los checks viejos estorban mientras migramos los datos.
ALTER TABLE wallet_movements DROP CONSTRAINT IF EXISTS wallet_movements_usd_check;
ALTER TABLE wallet_movements DROP CONSTRAINT IF EXISTS wallet_movements_tipo_check;
ALTER TABLE wallet_movements DROP CONSTRAINT IF EXISTS wallet_movements_moneda_check;
ALTER TABLE wallet_movements DROP CONSTRAINT IF EXISTS wallet_movements_cotizacion_check;

-- 3) Datos existentes: 'transferencia_ars' era el nombre viejo de 'ars'.
UPDATE wallet_movements SET tipo = 'ars' WHERE tipo = 'transferencia_ars';
UPDATE wallet_movements
   SET moneda = CASE WHEN tipo IN ('usd','usd_billete') THEN 'USD'
                     WHEN tipo = 'usdt'                 THEN 'USDT'
                     ELSE 'ARS' END
 WHERE moneda IS NULL;
-- Un retiro en ARS no lleva cotización; su monto de origen es el propio ARS.
UPDATE wallet_movements SET monto_origen = ars, cotizacion = NULL
 WHERE moneda = 'ARS' AND monto_origen IS NULL;

ALTER TABLE wallet_movements ALTER COLUMN moneda SET NOT NULL;
ALTER TABLE wallet_movements ALTER COLUMN monto_origen SET NOT NULL;

-- 4) Checks nuevos.
ALTER TABLE wallet_movements ADD CONSTRAINT wallet_movements_tipo_check
  CHECK (tipo IN ('ars','usd','usdt','usd_billete','ars_billete','ajuste'));
ALTER TABLE wallet_movements ADD CONSTRAINT wallet_movements_moneda_check
  CHECK (moneda IN ('ARS','USD','USDT'));
-- En ARS no hay conversión; en USD/USDT la cotización es obligatoria y positiva.
ALTER TABLE wallet_movements ADD CONSTRAINT wallet_movements_cotizacion_check
  CHECK (
    (moneda =  'ARS' AND cotizacion IS NULL) OR
    (moneda <> 'ARS' AND cotizacion IS NOT NULL AND cotizacion > 0)
  );
