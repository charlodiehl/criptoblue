-- ─────────────────────────────────────────────────────────────
-- Migración: registroLog (blob JSONB) → tabla relacional registro_log
-- Ejecutar en la consola SQL de Supabase, EN ESTE ORDEN.
-- NO ejecutar entero de una: hay pasos manuales de verificación entre medio.
--
-- ORDEN DE CUTOVER (importante — el flag cron-paused SOLO lo respeta el código
-- NUEVO; el código viejo en producción lo ignora, por eso poblamos ANTES del deploy):
--   1) PASO 1   — crear tabla + índices + función              (consola SQL)
--   2) PASO 3   — migrar datos (snapshot de los blobs)          (consola SQL)
--   3) PASO 2   — set flag cron-paused = true                   (consola SQL)
--   4) DEPLOY   — subir el código nuevo (lo hace el asistente tras confirmación)
--                 → el cron nuevo respeta el flag = pausado; la UI ya ve la tabla poblada
--   5) PASO 4   — catch-up idempotente (drift que el cron viejo agregó a los
--                 blobs entre el PASO 3 y el deploy)            (consola SQL)
--   6) PASO 3b  — verificación de conteos                       (consola SQL)
--   7) PASO 8   — borrar flag cron-paused → reanuda el cron     (consola SQL)
--   8) PASO 9   — (días después, estable) limpiar blobs viejos  (consola SQL)
-- ─────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════
-- PASO 1 — Crear tabla + índices (cron puede seguir corriendo, nada la usa aún)
-- ═══════════════════════════════════════════════

create table if not exists registro_log (
  id                  bigint generated always as identity primary key,
  ts                  timestamptz not null,        -- entry.timestamp (momento del registro)
  action              text not null,               -- auto_paid | manual_paid | needs_review | no_match | dismissed | cancelled
  source              text,                         -- emparejamiento | manual_pagos | manual_ordenes
  triggered_by        text,                         -- cron | manual_button | human
  score               numeric,
  amount              numeric,                       -- payment.monto
  order_total         numeric,                       -- order.total
  order_number        text,
  order_id            text,
  store_id            text,
  store_name          text,
  customer_name       text,
  cuit_pagador        text,
  mp_payment_id       text,
  payment_received_at text,                          -- payment.fechaPago (ISO, se guarda como texto)
  order_created_at    text,                          -- order.createdAt   (ISO, se guarda como texto)
  hidden              boolean not null default false,
  copied_at           timestamptz,
  payment             jsonb,                         -- objeto Payment completo (sin rawData)
  order_data          jsonb,                         -- objeto Order completo ("order" es palabra reservada)
  created_at          timestamptz not null default now()
);

create index if not exists registro_log_ts_idx         on registro_log (ts desc);
create index if not exists registro_log_order_id_idx   on registro_log (order_id) where order_id is not null;
create index if not exists registro_log_mp_payment_idx on registro_log (mp_payment_id) where mp_payment_id is not null;
create index if not exists registro_log_action_idx     on registro_log (action);

-- Función para listar meses disponibles (para el selector de la UI), en horario Argentina
create or replace function registro_log_months()
returns table(month text)
language sql stable as $$
  select distinct to_char(ts at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as month
  from registro_log
  order by month desc;
$$;


-- ═══════════════════════════════════════════════
-- PASO 2 — Pausar el cron (instantáneo, sin redeploy)
-- /api/run lee este flag y sale temprano si existe.
-- ═══════════════════════════════════════════════

insert into kv_store (key, value, updated_at)
values ('criptoblue:cron-paused', 'true'::jsonb, now())
on conflict (key) do update set value = 'true'::jsonb, updated_at = now();


-- ═══════════════════════════════════════════════
-- PASO 3 — Migrar datos: blobs → filas
-- Fuentes: criptoblue:logs (registroLog activo) + criptoblue:logs:YYYY-MM (archivos).
-- match-log NO se migra: es un subconjunto redundante de registroLog.
-- DISTINCT ON deduplica solapamientos entre el activo y el recién archivado.
-- ═══════════════════════════════════════════════

insert into registro_log (
  ts, action, source, triggered_by, score, amount, order_total,
  order_number, order_id, store_id, store_name, customer_name,
  cuit_pagador, mp_payment_id, payment_received_at, order_created_at,
  hidden, copied_at, payment, order_data
)
select distinct on (
  (e->>'timestamp'),
  (e->>'action'),
  coalesce(e->>'mpPaymentId', ''),
  coalesce(e->>'orderId', '')
)
  (e->>'timestamp')::timestamptz,
  e->>'action',
  e->>'source',
  e->>'triggeredBy',
  nullif(e->>'score', '')::numeric,
  nullif(e->>'amount', '')::numeric,
  nullif(e->>'orderTotal', '')::numeric,
  e->>'orderNumber',
  e->>'orderId',
  e->>'storeId',
  e->>'storeName',
  e->>'customerName',
  e->>'cuitPagador',
  e->>'mpPaymentId',
  e->>'paymentReceivedAt',
  e->>'orderCreatedAt',
  coalesce((e->>'hidden')::boolean, false),
  nullif(e->>'copiedAt', '')::timestamptz,
  e->'payment',
  e->'order'
from kv_store k
cross join lateral jsonb_array_elements(k.value->'registroLog') as e
where (k.key = 'criptoblue:logs' or k.key like 'criptoblue:logs:20%')
  and jsonb_typeof(k.value->'registroLog') = 'array';


-- ═══════════════════════════════════════════════
-- PASO 4 (DESPUÉS del deploy) — Catch-up idempotente
-- Captura las entradas que el cron VIEJO agregó a los blobs entre el PASO 3 y el
-- deploy (mientras el flag cron-paused todavía no se respetaba). Usa NOT EXISTS por
-- identidad (ts, action, mpPaymentId, orderId) para no duplicar lo ya migrado.
-- Es seguro re-ejecutarlo cuantas veces haga falta.
-- ═══════════════════════════════════════════════

insert into registro_log (
  ts, action, source, triggered_by, score, amount, order_total,
  order_number, order_id, store_id, store_name, customer_name,
  cuit_pagador, mp_payment_id, payment_received_at, order_created_at,
  hidden, copied_at, payment, order_data
)
select distinct on (
  (e->>'timestamp'),
  (e->>'action'),
  coalesce(e->>'mpPaymentId', ''),
  coalesce(e->>'orderId', '')
)
  (e->>'timestamp')::timestamptz,
  e->>'action',
  e->>'source',
  e->>'triggeredBy',
  nullif(e->>'score', '')::numeric,
  nullif(e->>'amount', '')::numeric,
  nullif(e->>'orderTotal', '')::numeric,
  e->>'orderNumber',
  e->>'orderId',
  e->>'storeId',
  e->>'storeName',
  e->>'customerName',
  e->>'cuitPagador',
  e->>'mpPaymentId',
  e->>'paymentReceivedAt',
  e->>'orderCreatedAt',
  coalesce((e->>'hidden')::boolean, false),
  nullif(e->>'copiedAt', '')::timestamptz,
  e->'payment',
  e->'order'
from kv_store k
cross join lateral jsonb_array_elements(k.value->'registroLog') as e
where (k.key = 'criptoblue:logs' or k.key like 'criptoblue:logs:20%')
  and jsonb_typeof(k.value->'registroLog') = 'array'
  and not exists (
    select 1 from registro_log r
    where r.ts = (e->>'timestamp')::timestamptz
      and r.action = e->>'action'
      and coalesce(r.mp_payment_id, '') = coalesce(e->>'mpPaymentId', '')
      and coalesce(r.order_id, '') = coalesce(e->>'orderId', '')
  );


-- ═══════════════════════════════════════════════
-- PASO 3b — VERIFICACIÓN (correr y comparar a mano antes de seguir)
-- ═══════════════════════════════════════════════

-- (a) Filas migradas a la tabla:
-- select count(*) as filas_migradas from registro_log;

-- (b) Entradas totales en los blobs (antes de deduplicar):
-- select coalesce(sum(jsonb_array_length(value->'registroLog')), 0) as entradas_en_blobs
-- from kv_store
-- where (key = 'criptoblue:logs' or key like 'criptoblue:logs:20%')
--   and jsonb_typeof(value->'registroLog') = 'array';

-- filas_migradas debe ser <= entradas_en_blobs (la diferencia = duplicados eliminados
-- por el solapamiento activo/archivo). Si filas_migradas > entradas_en_blobs, ALGO ESTÁ MAL.

-- (c) Chequeo de fechas extremas (sanity):
-- select min(ts), max(ts), count(*) from registro_log;


-- ═══════════════════════════════════════════════
-- PASO 8 (DESPUÉS del deploy y verificación en prod) — Reanudar el cron
-- ═══════════════════════════════════════════════

-- delete from kv_store where key = 'criptoblue:cron-paused';


-- ═══════════════════════════════════════════════
-- PASO 9 (días después, con todo estable) — Limpiar blobs viejos
-- Solo borra el registroLog de los blobs; deja errorLog/activityLog intactos.
-- ═══════════════════════════════════════════════

-- Borrar archivos mensuales completos (solo contenían registroLog):
-- delete from kv_store where key like 'criptoblue:logs:20%';

-- Quitar registroLog del blob activo, preservando errorLog/activityLog:
-- update kv_store set value = value - 'registroLog' where key = 'criptoblue:logs';

-- Borrar el blob de match-log (retirado):
-- delete from kv_store where key = 'criptoblue:match-log';
