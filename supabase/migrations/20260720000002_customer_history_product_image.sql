-- 20260720000002_customer_history_product_image.sql
-- Adds product_image_url + quantity to each order in get_customer_history_detail.
--
-- The repeat-buyer popover now renders each prior order as a card with the
-- product thumbnail (joined from products.image_url). We recreate the function
-- adding a LEFT JOIN products and two fields to the orders jsonb payload. The
-- match logic, lead/stats aggregation, signature and GRANT are unchanged from
-- 20260611000001_repeat_buyer_rpc.sql.

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

  -- Matched orders, ordered most-recent first, capped at 20. LEFT JOIN products
  -- so the popover card can show the product thumbnail.
  WITH matched AS (
    SELECT o.*, p.image_url AS product_image_url
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
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

GRANT EXECUTE ON FUNCTION get_customer_history_detail(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;
