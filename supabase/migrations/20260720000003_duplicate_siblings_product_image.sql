-- 20260720000003_duplicate_siblings_product_image.sql
-- Adds product_image_url to each duplicate sibling returned by
-- get_duplicate_orders_batch, so the duplicate popover cards can show the
-- product thumbnail. Recreates the function from
-- 20260720000001_duplicate_siblings_total_price.sql plus a LEFT JOIN products.
-- Signature, market-isolation guard, matching rules and GRANT are unchanged.

CREATE OR REPLACE FUNCTION get_duplicate_orders_batch(
  p_market_id UUID,
  p_rows JSONB   -- [{id, phone, phone_2, product_id, product_name, quantity, created_at}]
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

  -- Market isolation: anyone but super_admin must request their own market.
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
      coalesce((r->>'quantity')::INT, 0)            AS qty,
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
      p.image_url AS product_image_url,
      (o.status::TEXT IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered')) AS already_shipped
    FROM inputs i
    JOIN orders o
      ON o.market_id = p_market_id
     AND o.id <> i.src_id
     -- same phone (either field, either direction)
     AND (
       (i.np  <> '' AND (normalize_phone(o.customer_phone) = i.np  OR normalize_phone(o.customer_phone_2) = i.np))
       OR (i.np2 <> '' AND (normalize_phone(o.customer_phone) = i.np2 OR normalize_phone(o.customer_phone_2) = i.np2))
     )
     -- same product: prefer product_id when both present, else fall back to name
     AND (
       (i.pid IS NOT NULL AND o.product_id = i.pid)
       OR ((i.pid IS NULL OR o.product_id IS NULL) AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
     )
     -- same quantity
     AND o.quantity = i.qty
     -- within 24h either direction
     AND i.created_at IS NOT NULL
     AND abs(extract(epoch FROM (o.created_at - i.created_at))) <= 86400
     -- ignore dead siblings (no re-ship risk)
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
