-- ============================================================
-- 20260829000002_sargable_customer_history_and_duplicates.sql
-- Rewrite both agent-queue enrichment RPCs so their phone match can reach the
-- expression indexes added in 20260829000001. Behaviour is unchanged.
--
-- THE CHANGE, in both functions: the four-branch OR
--     (i.np  <> '' AND normalize_phone(o.customer_phone)   = i.np)
--  OR (i.np  <> '' AND normalize_phone(o.customer_phone_2) = i.np)
--  OR (i.np2 <> '' AND normalize_phone(o.customer_phone)   = i.np2)
--  OR (i.np2 <> '' AND normalize_phone(o.customer_phone_2) = i.np2)
-- becomes
--     normalize_phone(o.customer_phone)   = ANY (i.phones)
--  OR normalize_phone(o.customer_phone_2) = ANY (i.phones)
-- with phones = array_remove(ARRAY[np, np2], '') precomputed once per input.
--
-- WHY `= ANY` AND NOT A UNION. The obvious sargable rewrite — splitting the OR
-- into a UNION ALL of index-driven joins — is silently WRONG. A JOIN ON (a OR b)
-- emits ONE row per qualifying (input, order) pair however many branches hold;
-- a UNION ALL emits one row PER BRANCH. An order matching on both phone columns
-- would double-count into prior_order_count and into duplicate_count/siblings.
-- `= ANY` is a scalar boolean, so the 1:1 pairing is preserved by construction
-- and no DISTINCT is needed anywhere.
--
-- EQUIVALENCE. With P = array_remove(ARRAY[np,np2],''): the old predicate holds
-- iff some a in {np,np2} with a <> '' equals normalize_phone of either column;
-- the new holds iff either column's normalized value is in P. P is exactly
-- {np,np2} minus '', so they coincide. normalize_phone never returns NULL (it
-- returns ''), and x = ANY('{}') is false, which reproduces both <> '' guards.
--
-- Verified against production data before writing this migration, comparing the
-- FULL computed output of the old and new bodies, not just the match set:
--   market 2, 777 inputs: phone-match rows 494 vs 494; identity-fallback rows
--     1 vs 1; sum(prior_order_count) 495 vs 495; rows differing on any of
--     prior_order_count / delivered / returned / rejected / phone_matched /
--     last_known_address: 0.
--   market 1, 899 inputs: 720 vs 720 rows; old EXCEPT ALL new = 0;
--     new EXCEPT ALL old = 0; rows differing: 0.
--   get_duplicate_orders_batch, 613 inputs: 93 vs 93 rows; both EXCEPT ALL
--     directions 0.
-- Equal RAW row counts — not merely equal EXCEPT sets, which would have hidden
-- exactly the double-count the UNION form introduces. Input sets were chosen to
-- cover the entire match-producing population (every order sharing a normalized
-- phone with another) plus every order having a customer_phone_2, so the
-- order_identity_matches NOT-EXISTS fallback, the
-- (o.id <> i.src_id OR i.src_kind <> 'order') self-exclusion, the 'deleted'
-- exclusion and last_known_address ordering were all exercised.
--
-- SECOND CHANGE, get_duplicate_orders_batch only: the 24h window
--     abs(extract(epoch FROM (o.created_at - i.created_at))) <= 86400
-- becomes a plain range on o.created_at so it can act as an index bound and stop
-- being a per-pair function call. It uses interval '86400 seconds', NOT
-- interval '1 day': a day-interval is calendar arithmetic and is 23 or 25 hours
-- across a DST boundary, which would silently move the window. A
-- second-interval is an exact duration. Covered by the 613-input diff above.
--
-- DELIBERATELY UNCHANGED: lead_phone_matches keys on i.np only, never i.np2.
-- Switching it to ANY(i.phones) would ADD phone-2 matching and change what
-- prior_lead_count means. It is already a single sargable equality; it needed
-- only idx_leads_market_phone_norm from 20260829000001.
--
-- Both functions keep their exact argument lists and RETURNS TABLE column names
-- and types, so CREATE OR REPLACE is correct here. The DROP-first rule from
-- 20260827000005 applies to SIGNATURE changes; this is not one.
--
-- EXPECTED, for the worst real payload measured (270 active orders):
--   phone match      3,314 ms -> ~12 ms   (cost 239,586 -> 5,573)
--   lead match         105 ms -> ~2 ms
--   identity match      16.6 ms -> unchanged (already a Hash Join)
--   get_customer_history_batch mean 354.8 ms / max 7,791.6 ms -> well under
--   200 ms, i.e. it stops hitting the 8s authenticated statement_timeout at all.
--
-- NON-GOALS: the 8s role-level statement_timeout is deliberately left in place —
-- after this change it has ~650x headroom, and it is the only signal that would
-- catch a regression here (it is what located this bug). No RLS policy, table,
-- column or row is touched. order_history and inventory_log stay append-only.
-- ============================================================

-- normalize_phone is IMMUTABLE (provolatile='i') but PARALLEL UNSAFE
-- (proparallel='u'). That is a mis-marking, not a decision: it makes every query
-- referencing it parallel-unsafe, including the seq-scan fallbacks. Metadata
-- only — no body change, so the expression indexes from 20260829000001 stay
-- valid and need no rebuild.
ALTER FUNCTION public.normalize_phone(text) PARALLEL SAFE;


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
  -- `phones` collapses the old four-branch OR into one `= ANY` probe per phone
  -- column. array_remove(...,'') is what reproduces the old `<> ''` guards:
  -- x = ANY('{}') is false, so an input with no usable phone matches nothing.
  inputs AS (
    SELECT
      ir.*,
      array_remove(ARRAY[ir.np, ir.np2], '') AS phones
    FROM inputs_raw ir
  ),
  order_phone_matches AS (
    SELECT
      i.src_id,
      o.id AS oid,
      o.status::TEXT AS o_status,
      o.customer_address,
      o.created_at,
      TRUE AS by_phone
    FROM inputs i
    JOIN orders o
      ON o.market_id = p_market_id
     AND (o.id <> i.src_id OR i.src_kind <> 'order')
     AND o.status::TEXT <> 'deleted'
     AND (
       normalize_phone(o.customer_phone)   = ANY (i.phones)
       OR normalize_phone(o.customer_phone_2) = ANY (i.phones)
     )
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
    JOIN orders o
      ON o.market_id = p_market_id
     AND o.id <> i.src_id
     AND (
       normalize_phone(o.customer_phone)   = ANY (i.phones)
       OR normalize_phone(o.customer_phone_2) = ANY (i.phones)
     )
     AND (
       (i.pid IS NOT NULL AND o.product_id = i.pid)
       OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
     )
     AND i.created_at IS NOT NULL
     -- Range form of the old abs(extract(epoch ...)) <= 86400 so it can act as
     -- an index bound. Seconds, not interval '1 day': a day-interval is calendar
     -- arithmetic and becomes 23/25h across a DST boundary.
     AND o.created_at >= i.created_at - interval '86400 seconds'
     AND o.created_at <= i.created_at + interval '86400 seconds'
     AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
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
