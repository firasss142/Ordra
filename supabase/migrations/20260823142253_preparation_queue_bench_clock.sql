-- Préparation — measure the bench by the bench's own clock, and carry the
-- routing facts the roll colour needs.
--
-- WHY (the clock)
--   Age was measured from orders.created_at, which is the INTAKE clock: when
--   the webhook landed, before anyone phoned the customer. An order created
--   three weeks ago and uploaded this morning read "21 j en retard" on a bench
--   that had held it for two hours. The bench's clock starts when the order
--   reaches it — the `uploaded` event — and every late/oldest figure now uses
--   that one. In today's data the two agree, because all 407 Libyan orders are
--   old on either clock; they diverge the moment the bench is used.
--
-- WHY (the routing facts)
--   A Darb parcel needs a sticker off a specific COLOURED roll, and the colour
--   follows the destination branch. The queue must show it before the operator
--   picks the parcel up, not refuse them at the scanner. `branch_group` is
--   returned when we already know it; otherwise the route resolves it from the
--   darb_branches mirror in TypeScript, where the Arabic folding lives and is
--   tested. customer_area comes along because a city alone is ambiguous.
--
-- WHY (carrier_status_slug)
--   14 of the orders on the bench are already `released` at Darb — out for
--   delivery. They cannot be scanned and must not look like ordinary work.

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
  customer_area TEXT,
  customer_address TEXT,
  product_id UUID,
  product_name TEXT,
  variant_label TEXT,
  quantity INTEGER,
  total_price NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  -- When the order reached the bench. The clock every age on this screen uses.
  uploaded_at TIMESTAMPTZ,
  tracking_number TEXT,
  carrier_sticker_ref TEXT,
  carrier_status_slug TEXT,
  branch_group TEXT,
  has_carrier_ref BOOLEAN,
  current_stock INTEGER,
  low_stock_threshold INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city,
    o.carrier_extra->>'customer_area',
    o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    (SELECT MAX(h.created_at) FROM order_history h
      WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
    o.tracking_number,
    o.carrier_sticker_ref,
    o.carrier_status_slug,
    o.carrier_extra->>'darb_branch_group',
    (o.carrier_extra->>'darb_assabil_id') IS NOT NULL,
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

-- ── Queue stats on the same clock ───────────────────────────────────────────
--
-- late_prepare and never_scanned still PARTITION the backlog — they must not
-- overlap, or "total à rattraper" counts the same order twice — but both now
-- measure from the uploaded event rather than from intake. Orders with no
-- uploaded event fall back to created_at rather than vanishing from the counts.

CREATE OR REPLACE FUNCTION public.get_warehouse_queue_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH scoped AS (
    SELECT o.*,
           (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true' AS ours,
           COALESCE(
             (SELECT MAX(h.created_at) FROM order_history h
               WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
             o.created_at
           ) AS bench_at
    FROM orders o
    WHERE o.archived_at IS NULL
      AND (p_market_id IS NULL OR o.market_id = p_market_id)
  )
  SELECT json_build_object(
    'to_prepare',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours),
    'oldest_prepare_hours',
      COALESCE(
        MAX(EXTRACT(EPOCH FROM (now() - bench_at)) / 3600.0)
          FILTER (WHERE status = 'uploaded' AND ours),
        0
      )::INT,
    'late_prepare',
      COUNT(*) FILTER (
        WHERE status = 'uploaded' AND ours
          AND bench_at <  now() - INTERVAL '2 days'
          AND bench_at >= now() - INTERVAL '7 days'
      ),
    'never_scanned',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours AND bench_at < now() - INTERVAL '7 days'),
    'confirmed_not_uploaded',
      COUNT(*) FILTER (WHERE status = 'confirmed'),
    'carrier_warehouse',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND NOT ours),
    'returns_inbox',
      COUNT(*) FILTER (WHERE status = 'to_be_returned'),
    'to_hand_over',
      COUNT(*) FILTER (WHERE status = 'scanned'),
    -- Already out for delivery at the carrier: cannot be scanned, and must not
    -- read as ordinary bench work.
    'released_at_carrier',
      COUNT(*) FILTER (
        WHERE status = 'uploaded' AND ours
          AND carrier_status_slug IN ('released', 'completed', 'returning', 'returned')
      )
  )
  FROM scoped;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_queue_stats(UUID) TO PUBLIC;
