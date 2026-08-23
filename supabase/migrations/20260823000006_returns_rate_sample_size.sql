-- Retours — carry the sample the return rate is computed from.
--
-- WHY
--   Tunisia's card reads "TAUX DE RETOUR 100 %". That is arithmetically correct
--   and tells the operator nothing true: the 28-day window holds 3 returns and
--   ZERO deliveries, so the denominator is 3. Tunisia's all-time rate is 23 %
--   (1729 delivered / 522 returned).
--
--   A rate with no sample behind it is worse than no rate, because it looks
--   like a measurement. The function already returned NULL for an empty window;
--   it now also reports how many terminal orders each figure rests on, so the
--   console can withhold a number that would only mislead.
--
-- Every rate is computed exactly as before — the counts come off the same scans
-- that already produce them, so this adds no query.

CREATE OR REPLACE FUNCTION public.get_warehouse_returns_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_tz            TEXT := public.warehouse_market_tz(p_market_id);
  v_today         TIMESTAMPTZ;
  v_queue_n       INT;
  v_queue_val     NUMERIC;
  v_oldest_days   INT;
  v_done_n        INT;
  v_done_val      NUMERIC;
  v_restocked     INT;
  v_depreciated   INT;
  v_dep_units_28  INT;
  v_dep_value_28  NUMERIC;
  v_rate_28       NUMERIC;
  v_rate_prev_28  NUMERIC;
  v_sample_28     INT;
  v_sample_prev   INT;
  v_weekly        JSON;
BEGIN
  v_today := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  SELECT COUNT(*)::INT,
         COALESCE(SUM(total_price), 0),
         COALESCE(MAX(EXTRACT(DAY FROM (now() - created_at)))::INT, 0)
  INTO v_queue_n, v_queue_val, v_oldest_days
  FROM orders
  WHERE status = 'to_be_returned'
    AND archived_at IS NULL
    AND (p_market_id IS NULL OR market_id = p_market_id);

  SELECT COUNT(*)::INT, COALESCE(SUM(o.total_price), 0)
  INTO v_done_n, v_done_val
  FROM order_history h
  JOIN orders o ON o.id = h.order_id
  WHERE h.status_from = 'to_be_returned'
    AND h.status_to IN ('returned', 'received')
    AND h.created_at >= v_today
    AND (p_market_id IS NULL OR h.market_id = p_market_id);

  SELECT COUNT(*) FILTER (WHERE il.reason = 'returned')::INT,
         COUNT(*) FILTER (WHERE il.reason = 'damaged_writeoff')::INT
  INTO v_restocked, v_depreciated
  FROM inventory_log il
  JOIN products p ON p.id = il.product_id
  WHERE il.created_at >= v_today
    AND il.reason IN ('returned', 'damaged_writeoff')
    AND (p_market_id IS NULL OR p.market_id = p_market_id);

  SELECT COALESCE(SUM(il.change), 0)::INT,
         COALESCE(SUM(il.change * COALESCE(o.unit_price, 0)), 0)
  INTO v_dep_units_28, v_dep_value_28
  FROM inventory_log il
  JOIN products p ON p.id = il.product_id
  LEFT JOIN orders o ON o.id = il.order_id
  WHERE il.reason = 'damaged_writeoff'
    AND il.created_at >= now() - INTERVAL '28 days'
    AND (p_market_id IS NULL OR p.market_id = p_market_id);

  -- Both statuses are terminal, so terminal_at is the honest clock: created_at
  -- would mix orders still in flight into the denominator.
  --
  -- The sample comes off the same scan. It is the denominator, and a rate whose
  -- denominator is three is a coin toss dressed as a metric.
  SELECT COUNT(*)::INT,
         CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'returned') / COUNT(*), 1) END
  INTO v_sample_28, v_rate_28
  FROM orders
  WHERE status IN ('delivered', 'returned')
    AND terminal_at >= now() - INTERVAL '28 days'
    AND archived_at IS NULL
    AND (p_market_id IS NULL OR market_id = p_market_id);

  SELECT COUNT(*)::INT,
         CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'returned') / COUNT(*), 1) END
  INTO v_sample_prev, v_rate_prev_28
  FROM orders
  WHERE status IN ('delivered', 'returned')
    AND terminal_at >= now() - INTERVAL '56 days'
    AND terminal_at <  now() - INTERVAL '28 days'
    AND archived_at IS NULL
    AND (p_market_id IS NULL OR market_id = p_market_id);

  SELECT json_agg(json_build_object('week', w.n, 'rate', w.rate) ORDER BY w.n DESC)
  INTO v_weekly
  FROM (
    SELECT g.n,
           CASE WHEN COUNT(o.id) = 0 THEN NULL
                ELSE ROUND(100.0 * COUNT(o.id) FILTER (WHERE o.status = 'returned') / COUNT(o.id), 1) END AS rate
    FROM generate_series(4, 1, -1) AS g(n)
    LEFT JOIN orders o
      ON o.status IN ('delivered', 'returned')
     AND o.archived_at IS NULL
     AND o.terminal_at >= now() - (g.n * INTERVAL '7 days')
     AND o.terminal_at <  now() - ((g.n - 1) * INTERVAL '7 days')
     AND (p_market_id IS NULL OR o.market_id = p_market_id)
    GROUP BY g.n
  ) w;

  RETURN json_build_object(
    'queue_count',       COALESCE(v_queue_n, 0),
    'queue_value',       COALESCE(v_queue_val, 0),
    'oldest_days',       COALESCE(v_oldest_days, 0),
    'done_today',        COALESCE(v_done_n, 0),
    'done_today_value',  COALESCE(v_done_val, 0),
    'restocked_today',   COALESCE(v_restocked, 0),
    'depreciated_today', COALESCE(v_depreciated, 0),
    'depreciated_units', COALESCE(v_dep_units_28, 0),
    'depreciated_value', COALESCE(v_dep_value_28, 0),
    'rate_28d',          v_rate_28,
    'rate_prev_28d',     v_rate_prev_28,
    'sample_28d',        COALESCE(v_sample_28, 0),
    'sample_prev_28d',   COALESCE(v_sample_prev, 0),
    'weekly',            COALESCE(v_weekly, '[]'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_returns_stats(UUID) TO PUBLIC;
