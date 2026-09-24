-- Entrepôt mobile — the figures the phone screens show, computed from what we
-- already record.
--
-- The mockups in docs/design/entrepot/mobile/ put a figure and a sparkline on
-- every card: a stock goal, a per-item history, an accuracy percentage, a
-- scanning rate. None of those existed. Rather than draw them from nothing,
-- each one resolves here to something the warehouse actually did.
--
--   stock_goal            a target somebody set, NULL until they do
--   stock series          inventory_log.balance_after, which is already on
--                         every row and append-only — no new table
--   count accuracy        how close the books were to the shelf the last time
--                         someone counted it (reason = 'stock_count')
--   rate / last hour      the operator's own scans, from inventory_log
--
-- Nothing here invents a number. Where the warehouse has not done the work
-- yet, the function returns NULL and the screen says so.

-- ── A target for a product ──────────────────────────────────────────────────
--
-- NULLABLE on purpose. A goal nobody set must render as "no target", never as
-- "Goal: 0" — which would paint every product as catastrophically overstocked.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_goal INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_goal_non_negative'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_goal_non_negative
      CHECK (stock_goal IS NULL OR stock_goal >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.products.stock_goal IS
  'Target on-hand quantity for this product. NULL = no target set; the UI shows the low-stock threshold band instead of a progress bar. Distinct from low_stock_threshold, which is the alarm floor, not the aim.';

-- ── Per-product stock history ───────────────────────────────────────────────
--
-- One point per product per day: the balance after that day''s last movement,
-- carried forward across days with no movement — a stock level is a level, not
-- an event, so a quiet day is a flat line and not a gap.

CREATE OR REPLACE FUNCTION public.get_product_stock_series(
  p_product_ids UUID[],
  p_days        INT DEFAULT 14
)
RETURNS TABLE (
  product_id UUID,
  day        DATE,
  balance    INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT p.id,
         d.day::DATE,
         COALESCE(
           (SELECT il.balance_after
              FROM inventory_log il
             WHERE il.product_id = p.id
               -- generate_series over dates yields TIMESTAMP, so the day has
               -- to come back to DATE before a day can be added to it.
               AND il.created_at < (d.day::DATE + 1)
             ORDER BY il.created_at DESC, il.id DESC
             LIMIT 1),
           -- No movement on or before this day: the product existed at
           -- whatever it holds now, so a flat line is the honest drawing.
           p.current_stock
         )::INTEGER
  FROM products p
  CROSS JOIN LATERAL generate_series(
    (now()::DATE - (GREATEST(p_days, 1) - 1)),
    now()::DATE,
    INTERVAL '1 day'
  ) AS d(day)
  WHERE p.id = ANY(p_product_ids)
  ORDER BY p.id, d.day;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_stock_series(UUID[], INT) TO PUBLIC;

COMMENT ON FUNCTION public.get_product_stock_series(UUID[], INT) IS
  'Daily on-hand level per product, carried forward across days with no movement. Reads inventory_log.balance_after; writes nothing.';

-- ── Count accuracy ──────────────────────────────────────────────────────────
--
-- The mockups show an "Accuracy" figure per item. The only accuracy this
-- warehouse can honestly claim is how close the books were to the shelf the
-- last time a human counted it:
--
--   expected = balance_after - change   (what the system believed)
--   accuracy = 1 - |change| / max(expected, 1)
--
-- A product nobody has counted returns NULL, not 100 %. "Never verified" and
-- "verified and correct" are opposite facts and must not share a number.

CREATE OR REPLACE FUNCTION public.get_count_accuracy(
  p_market_id UUID DEFAULT NULL,
  p_days      INT  DEFAULT 90
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH counts AS (
    SELECT il.product_id,
           il.created_at,
           il.change,
           GREATEST(il.balance_after - il.change, 1) AS expected,
           ABS(il.change)                            AS variance
    FROM inventory_log il
    JOIN products p ON p.id = il.product_id
    WHERE il.reason = 'stock_count'
      AND il.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
      AND (p_market_id IS NULL OR p.market_id = p_market_id)
  ), per_product AS (
    SELECT DISTINCT ON (c.product_id)
           c.product_id,
           c.created_at AS last_counted_at,
           c.change     AS last_variance,
           ROUND(100.0 * (1 - LEAST(c.variance::NUMERIC / c.expected, 1)), 1) AS accuracy
    FROM counts c
    ORDER BY c.product_id, c.created_at DESC
  )
  SELECT json_build_object(
    'products', COALESCE(
      (SELECT json_agg(json_build_object(
                'product_id',      pp.product_id,
                'last_counted_at', pp.last_counted_at,
                'last_variance',   pp.last_variance,
                'accuracy',        pp.accuracy) ORDER BY pp.last_counted_at DESC)
         FROM per_product pp),
      '[]'::JSON),
    -- Weighted by units, not by product: a 1-unit slip on a shelf of 5 is a
    -- worse count than a 1-unit slip on a shelf of 500, and averaging the
    -- per-product percentages would hide that.
    'accuracy', (SELECT CASE WHEN SUM(expected) IS NULL THEN NULL
                             ELSE ROUND(100.0 * (1 - LEAST(SUM(variance)::NUMERIC / SUM(expected), 1)), 1) END
                   FROM counts),
    'counted_products', (SELECT COUNT(*)::INT FROM per_product),
    'counts',           (SELECT COUNT(*)::INT FROM counts)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_count_accuracy(UUID, INT) TO PUBLIC;

COMMENT ON FUNCTION public.get_count_accuracy(UUID, INT) IS
  'How close the books were to the shelf at the last physical count, per product and market-wide. NULL where nobody has counted — never 100 %.';

-- ── The operator''s own pace ────────────────────────────────────────────────
--
-- Adds the two figures the mobile dashboard shows beside the day total:
-- scans in the trailing hour, and scans per hour PRESENT (not per hour of the
-- day) — matching get_warehouse_leaderboard, which floors presence at 30 min
-- so a single scan cannot read as an infinite rate.

CREATE OR REPLACE FUNCTION public.get_operator_prep_stats(p_actor_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market_id   UUID;
  v_tz          TEXT;
  v_midnight    TIMESTAMPTZ;
  v_labels      INT;
  v_scanned     INT;
  v_avg_seconds INT;
  v_last_hour   INT;
  v_first       TIMESTAMPTZ;
  v_last        TIMESTAMPTZ;
  v_rate        NUMERIC;
BEGIN
  SELECT u.market_id INTO v_market_id FROM users u WHERE u.id = p_actor_id;
  v_tz := public.warehouse_market_tz(v_market_id);
  v_midnight := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  SELECT COUNT(*)::INT INTO v_labels
  FROM label_prints
  WHERE printed_by = p_actor_id AND created_at >= v_midnight;

  SELECT COUNT(*)::INT, MIN(created_at), MAX(created_at)
  INTO v_scanned, v_first, v_last
  FROM inventory_log
  WHERE actor_id = p_actor_id AND reason = 'scanned' AND created_at >= v_midnight;

  SELECT COUNT(*)::INT INTO v_last_hour
  FROM inventory_log
  WHERE actor_id = p_actor_id AND reason = 'scanned'
    AND created_at >= now() - INTERVAL '1 hour';

  SELECT COALESCE(AVG(LEAST(EXTRACT(EPOCH FROM (il.created_at - lp.created_at)), 3600)), 0)::INT
  INTO v_avg_seconds
  FROM inventory_log il
  JOIN (
    SELECT DISTINCT ON (order_id) order_id, created_at
    FROM label_prints
    WHERE printed_by = p_actor_id AND created_at >= v_midnight
    ORDER BY order_id, created_at ASC
  ) lp ON lp.order_id = il.order_id
  WHERE il.actor_id = p_actor_id
    AND il.reason = 'scanned'
    AND il.created_at >= v_midnight;

  -- No scans today: the rate is unknown, not zero. Zero would read as "this
  -- operator is standing still", which is a different claim.
  IF COALESCE(v_scanned, 0) = 0 THEN
    v_rate := NULL;
  ELSE
    v_rate := ROUND(
      v_scanned / GREATEST(EXTRACT(EPOCH FROM (v_last - v_first)) / 3600.0, 0.5),
      1
    );
  END IF;

  RETURN json_build_object(
    'labels_printed_today', COALESCE(v_labels, 0),
    'orders_scanned_today', COALESCE(v_scanned, 0),
    'avg_cycle_seconds',    COALESCE(v_avg_seconds, 0),
    'scans_last_hour',      COALESCE(v_last_hour, 0),
    'rate_per_hour',        v_rate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operator_prep_stats(UUID) TO PUBLIC;
