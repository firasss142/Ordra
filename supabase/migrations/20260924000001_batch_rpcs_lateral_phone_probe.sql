-- ============================================================
-- 20260924000001_batch_rpcs_lateral_phone_probe.sql
-- The two per-page enrichment RPCs stop scanning the market on every call.
--
-- WHY: get_customer_history_batch is called on every Orders list load and
-- every agent-queue load. Measured on this instance (pg_stat_statements,
-- 2026-09-08 17:00 → 2026-09-09 21:00): 620 calls, mean 2,625.6 ms, max
-- 7,377.2 ms — the max is the 8 s `authenticated` statement_timeout firing,
-- after which src/lib/customer-history/enrich.ts renders every badge empty.
-- At the Supabase gateway the same RPC is p50 3,265 ms / p95 4,953 ms. It is
-- 11 % of all database time and the single largest cost on the Orders page.
--
-- 20260829000002 rewrote the phone join as
--     normalize_phone(o.customer_phone) = ANY (i.phones)
-- expecting a BitmapOr over the two phone-norm expression indexes. The live
-- plan does not do that: with `i.phones` coming out of a CTE the planner
-- materialises every non-deleted order in the market and evaluates the join
-- filter for each input × order pair. Measured with a real 25-row page on the
-- Libya market (3,319 live orders):
--
--   before   Nested Loop + Materialize, 82,972 rows removed by join filter,
--            two plpgsql normalize_phone() calls per pair    456.7 ms
--   after    unnest(phones) → LATERAL → Index Scan on
--            idx_orders_market_phone_norm / _phone2_norm          40.7 ms
--            (the phone leg itself: 415 ms → 49 ms)
--
-- get_duplicate_orders_batch carries the identical join (mean 125.9 ms,
-- gateway p50 230 ms) and gets the identical rewrite: 20.9 ms on the same
-- sample, driven by idx_orders_market_created on the ±24 h window.
--
-- WHAT: in both functions the phone legs become one LATERAL subquery per
-- input row: `FROM unnest(i.phones) AS ph, orders o WHERE
-- normalize_phone(o.customer_phone) = ph` UNION the same on customer_phone_2.
-- The UNION (not UNION ALL) dedupes an order reached through both probes or
-- both columns, which is what keeps prior_order_count / duplicate_count from
-- inflating — the double-count trap 20260829000002 documents.
--
-- EQUIVALENCE, measured before applying: old body and new body run as plain
-- SELECTs over the 200 most recent orders of each market, compared with
-- EXCEPT ALL both ways plus row counts and sum(prior_order_count):
--   customer history  LY 0/0 rows differ, 200 rows, sum 23 = 23
--                     TN 0/0 rows differ, 200 rows, sum 42 = 42
--   duplicates        LY 0/0 rows differ, 5 sibling pairs = 5
--                     TN 0/0 rows differ, 16 sibling pairs = 16
--
-- Signatures, RETURNS TABLE, STABLE SECURITY DEFINER and the caller-market
-- guard are unchanged, so CREATE OR REPLACE keeps the existing grants and
-- creates no second overload.
--
-- NON-GOALS: no table, column, index, policy or trigger is touched. Nothing
-- is dropped. order_history and inventory_log remain append-only and
-- unreferenced. The identity leg (name + address + city) and the leads leg
-- are byte-for-byte the previous bodies.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_history_batch(p_market_id uuid, p_rows jsonb)
 RETURNS TABLE(source_id uuid, prior_order_count integer, prior_lead_count integer, prior_delivered_count integer, prior_returned_count integer, prior_rejected_count integer, phone_matched boolean, last_known_address text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_market UUID;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inputs_raw AS (
    SELECT
      (r->>'id')::UUID                    AS src_id,
      (r->>'source')                      AS src_kind,
      normalize_phone(r->>'phone')        AS np,
      normalize_phone(r->>'phone_2')      AS np2,
      lower(coalesce(trim(r->>'name'), ''))    AS nname,
      lower(coalesce(trim(r->>'address'), '')) AS naddr,
      lower(coalesce(trim(r->>'city'), ''))    AS ncity
    FROM jsonb_array_elements(p_rows) AS r
  ),
  inputs AS (
    SELECT ir.*, array_remove(ARRAY[ir.np, ir.np2], '') AS phones
    FROM inputs_raw ir
  ),
  -- One index probe per (input, phone) instead of one scan of the market per
  -- input. UNION dedupes an order reached through both probes or both columns.
  order_phone_matches AS (
    SELECT
      i.src_id,
      o.id AS oid,
      o.status::TEXT AS o_status,
      o.customer_address,
      o.created_at,
      TRUE AS by_phone
    FROM inputs i
    CROSS JOIN LATERAL (
      SELECT o.id, o.status, o.customer_address, o.created_at
      FROM unnest(i.phones) AS ph, orders o
      WHERE o.market_id = p_market_id
        AND normalize_phone(o.customer_phone) = ph
        AND (o.id <> i.src_id OR i.src_kind <> 'order')
        AND o.status::TEXT <> 'deleted'
      UNION
      SELECT o.id, o.status, o.customer_address, o.created_at
      FROM unnest(i.phones) AS ph, orders o
      WHERE o.market_id = p_market_id
        AND normalize_phone(o.customer_phone_2) = ph
        AND (o.id <> i.src_id OR i.src_kind <> 'order')
        AND o.status::TEXT <> 'deleted'
    ) o
  ),
  order_identity_matches AS (
    SELECT
      i.src_id,
      o.id AS oid,
      o.status::TEXT AS o_status,
      o.customer_address,
      o.created_at,
      FALSE AS by_phone
    FROM inputs i
    JOIN orders o
      ON o.market_id = p_market_id
     AND (o.id <> i.src_id OR i.src_kind <> 'order')
     AND o.status::TEXT <> 'deleted'
     AND i.nname <> '' AND i.naddr <> '' AND i.ncity <> ''
     AND lower(trim(o.customer_name)) = i.nname
     AND lower(trim(coalesce(o.customer_address, ''))) = i.naddr
     AND lower(trim(coalesce(o.customer_city, ''))) = i.ncity
    WHERE NOT EXISTS (
      SELECT 1 FROM order_phone_matches m WHERE m.src_id = i.src_id
    )
  ),
  order_matches AS (
    SELECT * FROM order_phone_matches
    UNION ALL
    SELECT * FROM order_identity_matches
  ),
  lead_phone_matches AS (
    SELECT
      i.src_id,
      l.id AS lid
    FROM inputs i
    JOIN leads l
      ON l.market_id = p_market_id
     AND (l.id <> i.src_id OR i.src_kind <> 'lead')
     AND i.np <> ''
     AND normalize_phone(l.customer_phone) = i.np
  ),
  per_input_orders AS (
    SELECT
      i.src_id,
      COUNT(om.oid)::INT                                       AS prior_order_count,
      COUNT(*) FILTER (WHERE om.o_status = 'delivered')::INT   AS prior_delivered_count,
      COUNT(*) FILTER (WHERE om.o_status = 'returned')::INT    AS prior_returned_count,
      COUNT(*) FILTER (WHERE om.o_status = 'rejected')::INT    AS prior_rejected_count,
      bool_or(om.by_phone)                                     AS phone_matched,
      (
        SELECT customer_address FROM order_matches om2
        WHERE om2.src_id = i.src_id AND om2.customer_address IS NOT NULL
        ORDER BY om2.created_at DESC
        LIMIT 1
      )                                                        AS last_known_address
    FROM inputs i
    LEFT JOIN order_matches om ON om.src_id = i.src_id
    GROUP BY i.src_id
  ),
  per_input_leads AS (
    SELECT i.src_id, COUNT(lpm.lid)::INT AS prior_lead_count
    FROM inputs i
    LEFT JOIN lead_phone_matches lpm ON lpm.src_id = i.src_id
    GROUP BY i.src_id
  )
  SELECT
    o.src_id                                          AS source_id,
    COALESCE(o.prior_order_count, 0)                  AS prior_order_count,
    COALESCE(l.prior_lead_count, 0)                   AS prior_lead_count,
    COALESCE(o.prior_delivered_count, 0)              AS prior_delivered_count,
    COALESCE(o.prior_returned_count, 0)               AS prior_returned_count,
    COALESCE(o.prior_rejected_count, 0)               AS prior_rejected_count,
    COALESCE(o.phone_matched, FALSE)                  AS phone_matched,
    o.last_known_address                              AS last_known_address
  FROM per_input_orders o
  JOIN per_input_leads  l ON l.src_id = o.src_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_duplicate_orders_batch(p_market_id uuid, p_rows jsonb)
 RETURNS TABLE(source_id uuid, duplicate_count integer, siblings jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_market UUID;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inputs_raw AS (
    SELECT
      (r->>'id')::UUID                              AS src_id,
      normalize_phone(r->>'phone')                  AS np,
      normalize_phone(r->>'phone_2')                AS np2,
      NULLIF(r->>'product_id', '')::UUID            AS pid,
      lower(coalesce(trim(r->>'product_name'), '')) AS pname,
      (r->>'created_at')::TIMESTAMPTZ               AS created_at
    FROM jsonb_array_elements(p_rows) AS r
  ),
  inputs AS (
    SELECT
      ir.*,
      array_remove(ARRAY[ir.np, ir.np2], '') AS phones
    FROM inputs_raw ir
  ),
  -- Same LATERAL probe as get_customer_history_batch; the ±86,400 s window and
  -- the product predicate stay inside so the planner can bound the scan on
  -- idx_orders_market_created. Seconds, not interval '1 day': a day-interval
  -- is calendar arithmetic and becomes 23/25h across a DST boundary.
  matches AS (
    SELECT
      i.src_id,
      o.id,
      o.external_id,
      o.status::TEXT AS status,
      o.created_at,
      o.product_name,
      o.quantity,
      o.total_price,
      o.customer_name,
      o.customer_address,
      o.customer_city,
      p.image_url AS product_image_url,
      (o.status::TEXT IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered')) AS already_shipped
    FROM inputs i
    CROSS JOIN LATERAL (
      SELECT o.id, o.external_id, o.status, o.created_at, o.product_name, o.quantity, o.total_price,
             o.customer_name, o.customer_address, o.customer_city, o.product_id
      FROM unnest(i.phones) AS ph, orders o
      WHERE o.market_id = p_market_id
        AND o.id <> i.src_id
        AND normalize_phone(o.customer_phone) = ph
        AND (
          (i.pid IS NOT NULL AND o.product_id = i.pid)
          OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
        )
        AND i.created_at IS NOT NULL
        AND o.created_at >= i.created_at - interval '86400 seconds'
        AND o.created_at <= i.created_at + interval '86400 seconds'
        AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
      UNION
      SELECT o.id, o.external_id, o.status, o.created_at, o.product_name, o.quantity, o.total_price,
             o.customer_name, o.customer_address, o.customer_city, o.product_id
      FROM unnest(i.phones) AS ph, orders o
      WHERE o.market_id = p_market_id
        AND o.id <> i.src_id
        AND normalize_phone(o.customer_phone_2) = ph
        AND (
          (i.pid IS NOT NULL AND o.product_id = i.pid)
          OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
        )
        AND i.created_at IS NOT NULL
        AND o.created_at >= i.created_at - interval '86400 seconds'
        AND o.created_at <= i.created_at + interval '86400 seconds'
        AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
    ) o
    LEFT JOIN products p ON p.id = o.product_id
  )
  SELECT
    i.src_id,
    COUNT(m.id)::INT AS duplicate_count,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',             m.id,
        'external_id',    m.external_id,
        'status',         m.status,
        'created_at',     m.created_at,
        'product_name',   m.product_name,
        'product_image_url', m.product_image_url,
        'quantity',       m.quantity,
        'total_price',    m.total_price,
        'customer_name',    m.customer_name,
        'customer_address', m.customer_address,
        'customer_city',    m.customer_city,
        'already_shipped', m.already_shipped
      ) ORDER BY m.already_shipped DESC, m.created_at DESC)
        FILTER (WHERE m.id IS NOT NULL),
      '[]'::jsonb
    ) AS siblings
  FROM inputs i
  LEFT JOIN matches m ON m.src_id = i.src_id
  GROUP BY i.src_id;
END;
$function$;
