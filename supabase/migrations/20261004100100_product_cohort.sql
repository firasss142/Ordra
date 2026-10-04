-- Produits v6 — the one read behind /products, /products/[id] and the edit page's
-- per-delivery calculator (plans/products-redesign-v6.md §4, prototypes/products-v6.html).
--
-- WHAT IT RETURNS: facts, not figures. One row per (order, product) for the orders
-- RECEIVED in the period, each followed to today. The buckets, rates and money are
-- computed in TypeScript (src/lib/products/cohort.ts, src/lib/calculations/
-- product-cohort.ts) where every rule has a unit test; this function only does the
-- joins PostgREST cannot do in one round trip.
--
-- The fate of an uploaded parcel is NOT decided here. It is read from
-- carrier_parcel_outcome, the view shared with the Transporteurs page, so a
-- "failed" parcel means the same thing on both pages. Its cost is read from
-- order_delivery_cost (20261004100000).
--
-- Read-only, SECURITY DEFINER, same market guard as get_team_funnel: super_admin
-- names the market, a market_manager is pinned to their own, everyone else gets '{}'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_order_lines — which products an order holds, and each one's part.
--    A product is in an order when it is orders.product_id or an order_items line.
--    Units = Σ order_items.quantity (order_stock_lines' grain), else orders.quantity.
--    Share = the product's line value ÷ the order's mapped line value; an unmapped
--    line is left out so the mapped products absorb the whole order value (the rule
--    of lib/calculations/order-revenue-attribution.ts). Zero-priced lines split evenly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.product_order_lines(
  p_market_id uuid, p_start timestamptz, p_end timestamptz, p_product_id uuid DEFAULT NULL
)
RETURNS TABLE (order_id uuid, product_id uuid, units numeric, share numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH coh AS (
    SELECT o.id, o.product_id, o.quantity
    FROM orders o
    WHERE o.market_id = p_market_id
      AND o.created_at >= p_start AND o.created_at < p_end
      AND (p_product_id IS NULL
           OR o.product_id = p_product_id
           OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.product_id = p_product_id))
  ),
  items AS (
    SELECT oi.order_id, oi.product_id,
           sum(oi.quantity)::numeric AS units,
           sum(COALESCE(oi.line_total, 0))::numeric AS value
    FROM order_items oi
    JOIN coh c ON c.id = oi.order_id
    WHERE oi.product_id IS NOT NULL
    GROUP BY oi.order_id, oi.product_id
  ),
  totals AS (
    SELECT i.order_id, sum(i.value) AS value, count(*) AS n FROM items i GROUP BY i.order_id
  )
  SELECT c.id, c.product_id, c.quantity::numeric, 1::numeric
  FROM coh c
  WHERE c.product_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM totals t WHERE t.order_id = c.id)
  UNION ALL
  SELECT i.order_id, i.product_id, i.units,
         CASE WHEN t.value > 0 THEN i.value / t.value ELSE 1::numeric / t.n END
  FROM items i
  JOIN totals t ON t.order_id = i.order_id;
$$;

COMMENT ON FUNCTION public.product_order_lines(uuid, timestamptz, timestamptz, uuid) IS
  'Products v6: one row per (order, product) for orders created in [start, end): units and the product''s share of the order value by line price. Internal to get_product_cohort.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_product_cohort
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_cohort(
  p_market_id uuid, p_from date, p_to date, p_tz text, p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    text := get_user_role();
  v_market  uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_today   date;
  v_start30 timestamptz;
  v_now     timestamptz := now();
  v_result  jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_tz IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  v_start   := p_from::timestamp AT TIME ZONE p_tz;
  v_end     := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_today   := (v_now AT TIME ZONE p_tz)::date;
  v_start30 := (v_today - 29)::timestamp AT TIME ZONE p_tz;

  WITH lines AS (
    SELECT * FROM product_order_lines(v_market, v_start, v_end, p_product_id) l
    WHERE p_product_id IS NULL OR l.product_id = p_product_id
  ),
  orders_in AS (SELECT DISTINCT l.order_id FROM lines l),
  att AS (
    SELECT h.order_id, count(*)::int AS n
    FROM order_history h JOIN orders_in x ON x.order_id = h.order_id
    WHERE h.status_to IN ('attempt_1', 'attempt_2', 'attempt_3')
    GROUP BY h.order_id
  ),
  conf AS (
    SELECT DISTINCT h.order_id
    FROM order_history h JOIN orders_in x ON x.order_id = h.order_id
    WHERE h.status_to IN ('confirmed', 'dispatch_scheduled', 'uploaded')
  ),
  left30 AS (
    SELECT l.product_id, sum(l.units) AS units
    FROM product_order_lines(v_market, v_start30, v_now, p_product_id) l
    JOIN carrier_parcel_outcome po ON po.order_id = l.order_id
    WHERE p_product_id IS NULL OR l.product_id = p_product_id
    GROUP BY l.product_id
  ),
  ads AS (
    SELECT a.product_id, d::date AS day,
           sum(a.amount / ((a.period_end - a.period_start) + 1)) AS amount
    FROM ad_spend a
    CROSS JOIN LATERAL generate_series(GREATEST(a.period_start, p_from),
                                       LEAST(a.period_end, p_to), interval '1 day') d
    WHERE a.market_id = v_market AND a.is_active AND a.product_id IS NOT NULL
      AND a.period_start <= p_to AND a.period_end >= p_from
      AND (p_product_id IS NULL OR a.product_id = p_product_id)
    GROUP BY a.product_id, d::date
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from,
    'to', p_to,
    'tz', p_tz,
    'generated_at', v_now,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', l.order_id,
        'product_id', l.product_id,
        'created_at', o.created_at,
        'status', o.status,
        'outcome', po.outcome,
        'outcome_at', po.outcome_at,
        'assigned_to', o.assigned_to,
        'rejection_reason', o.rejection_reason,
        'failure_cause', po.failure_cause,
        'attempts', COALESCE(a.n, 0),
        'units', l.units,
        'share', round(l.share, 6),
        'total_price', o.total_price,
        'delivery_cost', dc.delivery_cost,
        'return_cost', COALESCE(dc.return_cost, 0),
        'confirmed', (cf.order_id IS NOT NULL)
      ))
      FROM lines l
      JOIN orders o ON o.id = l.order_id
      LEFT JOIN carrier_parcel_outcome po ON po.order_id = l.order_id
      LEFT JOIN order_delivery_cost dc ON dc.order_id = l.order_id
      LEFT JOIN att a ON a.order_id = l.order_id
      LEFT JOIN conf cf ON cf.order_id = l.order_id
    ), '[]'::jsonb),
    'ads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product_id', s.product_id, 'day', s.day, 'amount', round(s.amount, 3))
                       ORDER BY s.product_id, s.day)
      FROM ads s
    ), '[]'::jsonb),
    'left_30d', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product_id', f.product_id, 'units', f.units)) FROM left30 f
    ), '[]'::jsonb),
    -- Darb's average invoice over the last 30 days: the fallback for a delivered
    -- parcel with neither invoice nor quote, labelled as an estimate on screen.
    'avg_delivery_cost', market_avg_delivery_cost(v_market),
    'last_order_at', (SELECT max(o.created_at) FROM orders o WHERE o.market_id = v_market),
    'last_ad_day', (
      SELECT max(a.period_end) FROM ad_spend a
      WHERE a.market_id = v_market AND a.is_active AND a.amount > 0
    ),
    'counted', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product_id', s.product_id, 'counted_at', s.counted_at))
      FROM (
        SELECT pss.product_id, max(pss.last_counted_at) AS counted_at
        FROM product_site_stock pss
        JOIN products p ON p.id = pss.product_id
        WHERE p.market_id = v_market AND pss.last_counted_at IS NOT NULL
          AND (p_product_id IS NULL OR pss.product_id = p_product_id)
        GROUP BY pss.product_id
      ) s
    ), '[]'::jsonb)
  ) INTO v_result;

  -- The product sheet needs four more things the list does not.
  IF p_product_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      -- Deliveries by the day they happened (a trend, not the cohort): orders of
      -- any age holding the product, delivered inside the window.
      'delivered_days', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('day', s.day, 'n', s.n) ORDER BY s.day)
        FROM (
          SELECT (po.outcome_at AT TIME ZONE p_tz)::date AS day, count(DISTINCT po.order_id) AS n
          FROM carrier_parcel_outcome po
          JOIN orders o ON o.id = po.order_id
          WHERE o.market_id = v_market
            AND po.outcome = 'delivered'
            AND po.outcome_at >= v_start AND po.outcome_at < v_end
            AND (o.product_id = p_product_id
                 OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.product_id = p_product_id))
          GROUP BY 1
        ) s
      ), '[]'::jsonb),
      'stock', jsonb_build_object(
        'scanned_30d', (
          SELECT COALESCE(-sum(il.change), 0) FROM inventory_log il
          WHERE il.product_id = p_product_id AND il.reason = 'scanned' AND il.created_at >= v_start30
        ),
        'returned_30d', (
          SELECT COALESCE(sum(il.change), 0) FROM inventory_log il
          WHERE il.product_id = p_product_id AND il.reason IN ('returned', 'received_back') AND il.created_at >= v_start30
        ),
        'moves', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('at', m.created_at, 'reason', m.reason,
                                              'change', m.change, 'balance_after', m.balance_after)
                           ORDER BY m.created_at DESC)
          FROM (
            SELECT il.created_at, il.reason, il.change, il.balance_after
            FROM inventory_log il
            WHERE il.product_id = p_product_id
            ORDER BY il.created_at DESC
            LIMIT 5
          ) m
        ), '[]'::jsonb)
      ),
      'last_order_at_product', (
        SELECT max(o.created_at) FROM orders o
        WHERE o.market_id = v_market
          AND (o.product_id = p_product_id
               OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.product_id = p_product_id))
      ),
      'users', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url))
        FROM users u
        WHERE u.id IN (SELECT (e ->> 'assigned_to')::uuid
                       FROM jsonb_array_elements(v_result -> 'lines') e
                       WHERE e ->> 'assigned_to' IS NOT NULL)
      ), '[]'::jsonb)
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_product_cohort(uuid, date, date, text, uuid) IS
  'Products v6: orders received in [from, to] (market-local days) followed to today — one fact row per (order, product) with the shared parcel outcome and the carrier cost — plus ad spend per day, units that left in the last 30 days, the market''s 30-day average invoice, and (for one product) deliveries per day, stock movements and agent names.';

-- Grants. SECURITY DEFINER functions are executable by PUBLIC by default: revoke
-- first, then grant only what the screens call. product_order_lines is internal.
REVOKE EXECUTE ON FUNCTION public.product_order_lines(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_cohort(uuid, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_cohort(uuid, date, date, text, uuid) TO authenticated;
