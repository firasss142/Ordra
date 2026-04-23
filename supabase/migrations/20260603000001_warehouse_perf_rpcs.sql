-- Warehouse performance RPCs
-- Replaces: 20,000-row trend fetch, two-query to-label/to-scan waterfalls, JS low-stock filter

-- 1. Trend aggregation: returns ≤15 rows instead of up to 20,000 raw inventory_log rows
CREATE OR REPLACE FUNCTION get_warehouse_trend(
  p_market_id uuid,
  p_from_date timestamptz,
  p_to_date   timestamptz
)
RETURNS TABLE(day date, scanned bigint, returned bigint, damaged bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    date_trunc('day', il.created_at AT TIME ZONE 'UTC')::date AS day,
    COALESCE(SUM(CASE WHEN il.reason = 'scanned'          THEN ABS(il.change) END), 0) AS scanned,
    COALESCE(SUM(CASE WHEN il.reason = 'returned'         THEN ABS(il.change) END), 0) AS returned,
    COALESCE(SUM(CASE WHEN il.reason = 'damaged_writeoff' THEN ABS(il.change) END), 0) AS damaged
  FROM inventory_log il
  JOIN products p ON p.id = il.product_id
  WHERE il.reason IN ('scanned', 'returned', 'damaged_writeoff')
    AND il.created_at >= p_from_date
    AND il.created_at <  p_to_date
    AND (p_market_id IS NULL OR p.market_id = p_market_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- 2. To-label: confirmed orders with NO label print — single query replaces 2-step waterfall
CREATE OR REPLACE FUNCTION get_to_label_orders(
  p_market_id uuid,
  p_limit     int DEFAULT 200
)
RETURNS TABLE(
  id                  uuid,
  customer_name       text,
  customer_phone      text,
  customer_city       text,
  customer_address    text,
  product_id          uuid,
  product_name        text,
  variant_label       text,
  quantity            int,
  total_price         numeric,
  status              text,
  created_at          timestamptz,
  current_stock       int,
  low_stock_threshold int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status, o.created_at,
    p.current_stock, p.low_stock_threshold
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  WHERE o.status = 'confirmed'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND NOT EXISTS (
      SELECT 1 FROM label_prints lp WHERE lp.order_id = o.id
    )
  ORDER BY o.created_at ASC
  LIMIT p_limit;
$$;

-- 3. To-scan: confirmed orders WITH a label print — single query replaces 2-step waterfall
CREATE OR REPLACE FUNCTION get_to_scan_orders(
  p_market_id uuid,
  p_limit     int DEFAULT 200
)
RETURNS TABLE(
  id                  uuid,
  customer_name       text,
  customer_phone      text,
  customer_city       text,
  customer_address    text,
  product_id          uuid,
  product_name        text,
  variant_label       text,
  quantity            int,
  total_price         numeric,
  status              text,
  created_at          timestamptz,
  current_stock       int,
  low_stock_threshold int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status, o.created_at,
    p.current_stock, p.low_stock_threshold
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  WHERE o.status = 'confirmed'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND EXISTS (
      SELECT 1 FROM label_prints lp WHERE lp.order_id = o.id
    )
  ORDER BY o.created_at ASC
  LIMIT p_limit;
$$;

-- 4. Low stock products: DB-side column comparison, replaces JS post-filter on 100-row over-fetch
CREATE OR REPLACE FUNCTION get_low_stock_products(
  p_market_id uuid,
  p_limit     int DEFAULT 20
)
RETURNS TABLE(
  id                  uuid,
  name                text,
  current_stock       int,
  low_stock_threshold int,
  market_id           uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, current_stock, low_stock_threshold, market_id
  FROM products
  WHERE is_active = true
    AND low_stock_threshold > 0
    AND current_stock < low_stock_threshold
    AND (p_market_id IS NULL OR market_id = p_market_id)
  ORDER BY current_stock ASC
  LIMIT p_limit;
$$;

-- Grant execute to authenticated users (RLS on underlying tables still enforced by SECURITY DEFINER callee check)
GRANT EXECUTE ON FUNCTION get_warehouse_trend(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION get_to_label_orders(uuid, int)                      TO authenticated;
GRANT EXECUTE ON FUNCTION get_to_scan_orders(uuid, int)                       TO authenticated;
GRANT EXECUTE ON FUNCTION get_low_stock_products(uuid, int)                   TO authenticated;
