-- The packing bench was reading the wrong queue.
--
-- get_to_label_orders still filtered `status = 'confirmed'`, correct before the
-- uploaded status model (20260506000000). Since then a confirmed order has NOT
-- reached the carrier — no tracking number, no parcel to pack. The bench
-- therefore showed 1 Libyan order while Aujourd'hui correctly reported 407.
--
-- Two further corrections:
--   * Orders the carrier ships from its own warehouse never reach our bench.
--     Those units left our stock at handover; scanning them would deduct twice
--     and scan-out refuses them anyway.
--   * The "no label printed yet" filter is gone. The redesigned console is one
--     queue: an order stays on the bench from arrival until it is scanned out,
--     printed or not. In Libya nothing is ever printed.
--
-- Dropped rather than replaced: the signature keeps its defaults and the
-- status column stays TEXT, both of which CREATE OR REPLACE refuses to alter.
DROP FUNCTION IF EXISTS public.get_to_label_orders(UUID, INTEGER, TIMESTAMPTZ, UUID);

CREATE FUNCTION public.get_to_label_orders(
  p_market_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_address TEXT,
  product_id UUID,
  product_name TEXT,
  variant_label TEXT,
  quantity INTEGER,
  total_price NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  current_stock INTEGER,
  low_stock_threshold INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    p.current_stock, p.low_stock_threshold
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  WHERE o.status = 'uploaded'
    AND o.archived_at IS NULL
    AND (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_to_label_orders(UUID, INTEGER, TIMESTAMPTZ, UUID) TO PUBLIC;
