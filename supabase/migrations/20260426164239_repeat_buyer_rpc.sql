-- 20260611000001_repeat_buyer_rpc.sql
-- Repeat-buyer detection across orders + leads, scoped per market.
-- Two RPCs:
--   1. get_customer_history_batch — list-page enrichment (count + classification)
--   2. get_customer_history_detail — popover content (full order/lead history)
-- Both SECURITY DEFINER. Both enforce market isolation internally.

-- ============================================================
-- Indexes — phone indexes already exist (orders + leads).
-- Add functional indexes for identity-fallback matching.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_market_identity
  ON orders (market_id, lower(customer_name), lower(customer_address));

CREATE INDEX IF NOT EXISTS idx_leads_market_identity
  ON leads (market_id, lower(customer_name), lower(customer_address));

-- ============================================================
-- Phone normalization (mirrors src/lib/leads/phone.ts::normalizePhone)
-- ============================================================
CREATE OR REPLACE FUNCTION normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  IF p_phone IS NULL OR length(p_phone) = 0 THEN RETURN ''; END IF;
  v := regexp_replace(p_phone, '[\s\-\.\(\) ]', '', 'g');
  IF substring(v, 1, 1) = '+' THEN v := substring(v, 2); END IF;
  IF substring(v, 1, 5) = '00216' THEN RETURN substring(v, 6); END IF;
  IF substring(v, 1, 5) = '00218' THEN RETURN substring(v, 6); END IF;
  IF substring(v, 1, 3) = '216' AND length(v) > 3 THEN RETURN substring(v, 4); END IF;
  IF substring(v, 1, 3) = '218' AND length(v) > 3 THEN RETURN substring(v, 4); END IF;
  RETURN v;
END;
$$;

-- ============================================================
-- RPC 1: get_customer_history_batch
-- Input: array of {id, phone, phone_2, name, address, city, source}
-- Returns: one row per input, with prior counts + classification fields.
-- The caller decides whether to apply the result based on its own RLS check.
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

  -- Market isolation: anyone but super_admin must request their own market.
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
  -- Phone matches against orders
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
     AND (
       (i.np  <> '' AND normalize_phone(o.customer_phone) = i.np)
       OR (i.np  <> '' AND normalize_phone(o.customer_phone_2) = i.np)
       OR (i.np2 <> '' AND normalize_phone(o.customer_phone) = i.np2)
       OR (i.np2 <> '' AND normalize_phone(o.customer_phone_2) = i.np2)
     )
  ),
  -- Identity matches against orders (only kept if phone match did NOT fire)
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
  -- Lead matches by phone (always; leads are weak signal so we only count them)
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

-- ============================================================
-- RPC 2: get_customer_history_detail
-- Returns the full popover payload for one source row.
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

  -- Matched orders, ordered most-recent first, capped at 20
  WITH matched AS (
    SELECT o.*
    FROM orders o
    WHERE o.market_id = p_market_id
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
    'customer_address', m.customer_address,
    'customer_city',    m.customer_city,
    'product_name',     m.product_name,
    'variant_label',    m.variant_label,
    'phone_matched',
      (v_np  <> '' AND (normalize_phone(m.customer_phone) = v_np  OR normalize_phone(m.customer_phone_2) = v_np))
      OR
      (v_np2 <> '' AND (normalize_phone(m.customer_phone) = v_np2 OR normalize_phone(m.customer_phone_2) = v_np2))
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM matched m;

  -- Matched leads (phone only, capped at 10)
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

  -- Aggregate stats from the matched-orders subset (re-computed, capped)
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

-- Grant execute to authenticated users (RLS enforced inside the function body)
GRANT EXECUTE ON FUNCTION get_customer_history_batch(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_customer_history_detail(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION normalize_phone(TEXT) TO authenticated;
