-- 20260722000001_exclude_deleted_and_relax_dup_quantity.sql
-- Two related corrections to the repeat-buyer + duplicate-detection signals:
--
-- 1. Exclude deleted orders from the repeat-buyer count and popover history.
--    A deleted order is one a manager marked as "should not have existed" via
--    the duplicate-delete flow or the manager delete action. It should not
--    inflate prior_order_count or appear in the customer-history timeline.
--    Cancelled and rejected orders still count — they were genuine attempts.
--    Touches: get_customer_history_batch, get_customer_history_detail.
--
-- 2. Drop the same-quantity constraint in duplicate detection. A customer
--    re-placing the same product within 24h is the duplicate signal we care
--    about — the quantity often changes between attempts ("oh I meant 2 not 1").
--    Phone + product + 24h window is enough; the popover still shows quantity
--    per sibling so the agent can tell live duplicates from genuine re-orders.
--    Touches: get_duplicate_orders_batch.
--
-- All three are recreated from their latest definitions
-- (20260720000005 for the history RPCs, 20260720000004 for the duplicate RPC).
-- Signatures, GRANTs, and market-isolation guards are unchanged.

-- ============================================================
-- get_customer_history_batch — exclude deleted prior orders
-- Source: 20260611000001_repeat_buyer_rpc.sql (only orders matches change)
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_history_batch(
  p_market_id UUID,
  p_rows JSONB
)
RETURNS TABLE (
  source_id UUID,
  prior_order_count INT,
  prior_lead_count INT,
  prior_delivered_count INT,
  prior_returned_count INT,
  prior_rejected_count INT,
  phone_matched BOOLEAN,
  last_known_address TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
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
  WITH inputs AS (
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
       (i.np  <> '' AND normalize_phone(o.customer_phone) = i.np)
       OR (i.np  <> '' AND normalize_phone(o.customer_phone_2) = i.np)
       OR (i.np2 <> '' AND normalize_phone(o.customer_phone) = i.np2)
       OR (i.np2 <> '' AND normalize_phone(o.customer_phone_2) = i.np2)
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
$$;

GRANT EXECUTE ON FUNCTION get_customer_history_batch(UUID, JSONB) TO authenticated;

-- ============================================================
-- get_customer_history_detail — exclude deleted prior orders
-- Source: 20260720000005_customer_history_customer_name.sql (only matches CTE changes)
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_history_detail(
  p_market_id UUID,
  p_phone TEXT,
  p_phone_2 TEXT,
  p_name TEXT,
  p_address TEXT,
  p_city TEXT,
  p_exclude_order_id UUID,
  p_exclude_lead_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_market UUID;
  v_np TEXT;
  v_np2 TEXT;
  v_nname TEXT;
  v_naddr TEXT;
  v_ncity TEXT;
  v_orders JSONB;
  v_leads JSONB;
  v_aggregate JSONB;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();
  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_np    := normalize_phone(p_phone);
  v_np2   := normalize_phone(p_phone_2);
  v_nname := lower(coalesce(trim(p_name), ''));
  v_naddr := lower(coalesce(trim(p_address), ''));
  v_ncity := lower(coalesce(trim(p_city), ''));

  WITH matched AS (
    SELECT o.*, p.image_url AS product_image_url
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.market_id = p_market_id
      AND o.status::TEXT <> 'deleted'
      AND (p_exclude_order_id IS NULL OR o.id <> p_exclude_order_id)
      AND (
        (v_np <> '' AND (
          normalize_phone(o.customer_phone) = v_np
          OR normalize_phone(o.customer_phone_2) = v_np
        ))
        OR (v_np2 <> '' AND (
          normalize_phone(o.customer_phone) = v_np2
          OR normalize_phone(o.customer_phone_2) = v_np2
        ))
        OR (
          v_nname <> '' AND v_naddr <> '' AND v_ncity <> ''
          AND lower(trim(o.customer_name)) = v_nname
          AND lower(trim(coalesce(o.customer_address, ''))) = v_naddr
          AND lower(trim(coalesce(o.customer_city, ''))) = v_ncity
        )
      )
    ORDER BY o.created_at DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',          m.id,
    'external_id', m.external_id,
    'created_at',  m.created_at,
    'status',      m.status,
    'total_price', m.total_price,
    'currency',    NULL,
    'customer_name',    m.customer_name,
    'customer_address', m.customer_address,
    'customer_city',    m.customer_city,
    'product_name',     m.product_name,
    'product_image_url', m.product_image_url,
    'quantity',         m.quantity,
    'variant_label',    m.variant_label,
    'phone_matched',
      (v_np  <> '' AND (normalize_phone(m.customer_phone) = v_np  OR normalize_phone(m.customer_phone_2) = v_np))
      OR
      (v_np2 <> '' AND (normalize_phone(m.customer_phone) = v_np2 OR normalize_phone(m.customer_phone_2) = v_np2))
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM matched m;

  WITH matched_leads AS (
    SELECT l.*
    FROM leads l
    WHERE l.market_id = p_market_id
      AND (p_exclude_lead_id IS NULL OR l.id <> p_exclude_lead_id)
      AND v_np <> ''
      AND normalize_phone(l.customer_phone) = v_np
    ORDER BY l.created_at DESC
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',         ml.id,
    'created_at', ml.created_at,
    'status',     ml.status,
    'source',     ml.source
  ) ORDER BY ml.created_at DESC), '[]'::jsonb)
  INTO v_leads
  FROM matched_leads ml;

  SELECT jsonb_build_object(
    'total_orders',
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(v_orders)), 0),
    'delivered_count',
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(v_orders) e
                WHERE e->>'status' = 'delivered'), 0),
    'returned_count',
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(v_orders) e
                WHERE e->>'status' = 'returned'), 0),
    'rejected_count',
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(v_orders) e
                WHERE e->>'status' = 'rejected'), 0),
    'lifetime_value',
      COALESCE((SELECT SUM((e->>'total_price')::NUMERIC) FROM jsonb_array_elements(v_orders) e
                WHERE e->>'status' = 'delivered'), 0)
  ) INTO v_aggregate;

  RETURN jsonb_build_object(
    'orders', v_orders,
    'leads',  v_leads,
    'stats',  v_aggregate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_history_detail(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ============================================================
-- get_duplicate_orders_batch — drop same-quantity constraint
-- Source: 20260720000004_duplicate_siblings_customer_fields.sql (quantity predicate removed)
-- ============================================================
CREATE OR REPLACE FUNCTION get_duplicate_orders_batch(
  p_market_id UUID,
  p_rows JSONB
)
RETURNS TABLE (
  source_id        UUID,
  duplicate_count  INT,
  siblings         JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
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
  WITH inputs AS (
    SELECT
      (r->>'id')::UUID                              AS src_id,
      normalize_phone(r->>'phone')                  AS np,
      normalize_phone(r->>'phone_2')                AS np2,
      NULLIF(r->>'product_id', '')::UUID            AS pid,
      lower(coalesce(trim(r->>'product_name'), '')) AS pname,
      (r->>'created_at')::TIMESTAMPTZ               AS created_at
    FROM jsonb_array_elements(p_rows) AS r
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
       (i.np  <> '' AND (normalize_phone(o.customer_phone) = i.np  OR normalize_phone(o.customer_phone_2) = i.np))
       OR (i.np2 <> '' AND (normalize_phone(o.customer_phone) = i.np2 OR normalize_phone(o.customer_phone_2) = i.np2))
     )
     AND (
       (i.pid IS NOT NULL AND o.product_id = i.pid)
       OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
     )
     AND i.created_at IS NOT NULL
     AND abs(extract(epoch FROM (o.created_at - i.created_at))) <= 86400
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
$$;

GRANT EXECUTE ON FUNCTION get_duplicate_orders_batch(UUID, JSONB) TO authenticated;
