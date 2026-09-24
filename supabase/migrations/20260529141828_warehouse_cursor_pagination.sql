-- Cursor-based keyset pagination for warehouse queues.
-- Both queues order by (created_at ASC, id ASC); cursors return rows strictly AFTER the cursor pair.

-- Drop prior signatures so CREATE OR REPLACE below can change the argument list
-- (CREATE OR REPLACE can't change a function's signature in place).
DROP FUNCTION IF EXISTS get_to_label_orders(uuid, integer);
DROP FUNCTION IF EXISTS get_to_label_orders(uuid, int, timestamptz, uuid);
DROP FUNCTION IF EXISTS get_to_be_returned_orders(uuid, integer);
DROP FUNCTION IF EXISTS get_to_be_returned_orders(uuid, int, timestamptz, uuid);

CREATE OR REPLACE FUNCTION get_to_label_orders(
  p_market_id          uuid,
  p_limit              int        DEFAULT 50,
  p_cursor_created_at  timestamptz DEFAULT NULL,
  p_cursor_id          uuid       DEFAULT NULL
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
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_to_label_orders(uuid, int, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_to_be_returned_orders(
  p_market_id          uuid,
  p_limit              int        DEFAULT 50,
  p_cursor_created_at  timestamptz DEFAULT NULL,
  p_cursor_id          uuid       DEFAULT NULL
)
RETURNS TABLE(
  id                uuid,
  customer_name     text,
  customer_phone    text,
  customer_city     text,
  customer_address  text,
  product_id        uuid,
  product_name      text,
  variant_label     text,
  quantity          int,
  total_price       numeric,
  status            text,
  created_at        timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status, o.created_at
  FROM orders o
  WHERE o.status = 'to_be_returned'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_to_be_returned_orders(uuid, int, timestamptz, uuid) TO authenticated;
