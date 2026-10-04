-- Performance › Commandes — the one read behind /performance/orders
-- (plans/performance-commandes.md, prototypes/performance-commandes-v4.html).
--
-- WHAT IT RETURNS: facts, not figures. One row per order RECEIVED in the period
-- (market-local days), followed to today, plus its product lines; the buckets,
-- rates, leaks and money are computed in TypeScript (src/lib/performance/orders,
-- src/lib/calculations/orders-performance-money.ts) where every rule has a test.
--
-- Same definitions as Produits (get_product_cohort, 20261004100100):
--   · the fate of an uploaded parcel is read from carrier_parcel_outcome;
--   · a product's part of an order comes from product_order_lines (line value).
--
-- Read-only, SECURITY DEFINER, the market guard of get_product_cohort:
-- super_admin names the market, a market_manager is pinned to their own,
-- everyone else gets '{}'. Money (total_price) is filtered out for managers by
-- the API, not here: the page counts orders for them, it never shows prices.

CREATE OR REPLACE FUNCTION public.get_orders_performance(
  p_market_id uuid, p_from date, p_to date, p_tz text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := get_user_role();
  v_market uuid;
  v_start  timestamptz;
  v_end    timestamptz;
  v_result jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_tz IS NULL
     OR p_to - p_from > 400 THEN
    RETURN '{}'::jsonb;
  END IF;

  v_start := p_from::timestamp AT TIME ZONE p_tz;
  v_end   := (p_to + 1)::timestamp AT TIME ZONE p_tz;

  WITH coh AS (
    SELECT o.id, o.external_id, o.created_at, o.status, o.assigned_to, o.rejection_reason,
           o.rejection_subreason, o.total_price, o.customer_city, o.product_id, o.product_variant_id
    FROM orders o
    WHERE o.market_id = v_market AND o.created_at >= v_start AND o.created_at < v_end
  ),
  lines AS (
    SELECT * FROM product_order_lines(v_market, v_start, v_end, NULL)
  ),
  -- The sizes (attribute variants) of each product in each order; packs are not sizes.
  sizes AS (
    SELECT oi.order_id, oi.product_id, array_agg(DISTINCT oi.variant_id) AS variants
    FROM order_items oi
    JOIN coh c ON c.id = oi.order_id
    JOIN product_variants pv ON pv.id = oi.variant_id AND pv.kind = 'attribute'
    GROUP BY oi.order_id, oi.product_id
    UNION ALL
    SELECT c.id, c.product_id, ARRAY[c.product_variant_id]
    FROM coh c
    JOIN product_variants pv ON pv.id = c.product_variant_id AND pv.kind = 'attribute'
    WHERE NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = c.id)
  ),
  ads AS (
    SELECT d::date AS day, sum(a.amount / ((a.period_end - a.period_start) + 1)) AS amount
    FROM ad_spend a
    CROSS JOIN LATERAL generate_series(GREATEST(a.period_start, p_from), LEAST(a.period_end, p_to), interval '1 day') d
    WHERE a.market_id = v_market AND a.is_active
      AND a.period_start <= p_to AND a.period_end >= p_from
    GROUP BY d::date
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from,
    'to', p_to,
    'tz', p_tz,
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'ref', c.external_id,
        'created_at', c.created_at,
        'status', c.status,
        'outcome', po.outcome,
        'failure_cause', po.failure_cause,
        'assigned_to', c.assigned_to,
        'rejection_reason', c.rejection_reason,
        'rejection_subreason', c.rejection_subreason,
        'total_price', c.total_price,
        'city', NULLIF(btrim(c.customer_city), '')
      ))
      FROM coh c
      LEFT JOIN carrier_parcel_outcome po ON po.order_id = c.id
    ), '[]'::jsonb),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', l.order_id,
        'product_id', l.product_id,
        'share', round(l.share, 6),
        'variants', COALESCE(to_jsonb(s.variants), '[]'::jsonb)
      ))
      FROM lines l
      LEFT JOIN sizes s ON s.order_id = l.order_id AND s.product_id = l.product_id
    ), '[]'::jsonb),
    'ads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', s.day, 'amount', round(s.amount, 3)) ORDER BY s.day) FROM ads s
    ), '[]'::jsonb),
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'color', u.color, 'avatar_url', u.avatar_url))
      FROM users u
      WHERE u.id IN (SELECT DISTINCT c.assigned_to FROM coh c WHERE c.assigned_to IS NOT NULL)
    ), '[]'::jsonb),
    'first_order_at', (SELECT min(o.created_at) FROM orders o WHERE o.market_id = v_market)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_orders_performance(uuid, date, date, text) IS
  'Performance › Commandes: orders received in [from, to] (market-local days) followed to today — one row per order with the shared parcel outcome, its product lines (share by line value, sizes), ad spend per day, the agents, and the market''s first order.';

-- SECURITY DEFINER functions are executable by PUBLIC by default: revoke first.
REVOKE EXECUTE ON FUNCTION public.get_orders_performance(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_performance(uuid, date, date, text) TO authenticated;
