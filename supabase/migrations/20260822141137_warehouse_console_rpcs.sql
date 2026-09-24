-- Entrepôt — the figures the console shows, computed honestly.
--
-- Replaces the fabrications the overview shipped with:
--   * snapshotKpi() set previous = current and delta = 0, so "Aujourd'hui vs
--     hier" compared a number to itself and always drew a flat 0 %.
--   * there was no team query at all, so "Classement" could not exist.
-- Both are derivable: scan_order_out already writes inventory_log (with the
-- actor) and order_history (with the market), and always has.
--
-- Also repairs get_operator_prep_stats, which has been RAISING in production:
-- it reads COALESCE(m.timezone, 'UTC') and markets has no timezone column, so
-- /api/warehouse/operator-stats 500s on every call. The timezone is resolved
-- from the market code instead, matching 20260827000002_stamp_next_retry_slot.

-- ── Timezone, one definition ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.warehouse_market_tz(p_market_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT CASE code WHEN 'ly' THEN 'Africa/Tripoli' ELSE 'Africa/Tunis' END
     FROM markets WHERE id = p_market_id),
    'Africa/Tunis'
  );
$$;

COMMENT ON FUNCTION public.warehouse_market_tz(UUID) IS
  'Local timezone for a market. markets has no timezone column; the mapping lives here so every "today" in the warehouse agrees.';

-- ── Repair: per-operator prep stats ─────────────────────────────────────────

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
BEGIN
  SELECT u.market_id INTO v_market_id FROM users u WHERE u.id = p_actor_id;
  v_tz := public.warehouse_market_tz(v_market_id);
  v_midnight := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  SELECT COUNT(*)::INT INTO v_labels
  FROM label_prints
  WHERE printed_by = p_actor_id AND created_at >= v_midnight;

  SELECT COUNT(*)::INT INTO v_scanned
  FROM inventory_log
  WHERE actor_id = p_actor_id AND reason = 'scanned' AND created_at >= v_midnight;

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

  RETURN json_build_object(
    'labels_printed_today', COALESCE(v_labels, 0),
    'orders_scanned_today', COALESCE(v_scanned, 0),
    'avg_cycle_seconds',    COALESCE(v_avg_seconds, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operator_prep_stats(UUID) TO PUBLIC;

-- ── Today vs yesterday ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_warehouse_day_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz     TEXT := public.warehouse_market_tz(p_market_id);
  v_today  TIMESTAMPTZ;
  v_yest   TIMESTAMPTZ;
BEGIN
  v_today := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_yest  := v_today - INTERVAL '1 day';

  RETURN (
    SELECT json_build_object(
      'scanned_today',      COUNT(*) FILTER (WHERE status_to = 'scanned'    AND created_at >= v_today),
      'scanned_yesterday',  COUNT(*) FILTER (WHERE status_to = 'scanned'    AND created_at >= v_yest AND created_at < v_today),
      'handed_today',       COUNT(*) FILTER (WHERE status_to = 'dispatched' AND created_at >= v_today),
      'handed_yesterday',   COUNT(*) FILTER (WHERE status_to = 'dispatched' AND created_at >= v_yest AND created_at < v_today),
      'returns_today',      COUNT(*) FILTER (WHERE status_to IN ('returned','received') AND status_from = 'to_be_returned' AND created_at >= v_today),
      'returns_yesterday',  COUNT(*) FILTER (WHERE status_to IN ('returned','received') AND status_from = 'to_be_returned' AND created_at >= v_yest AND created_at < v_today)
    )
    FROM order_history
    WHERE created_at >= v_yest
      AND (p_market_id IS NULL OR market_id = p_market_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_day_stats(UUID) TO PUBLIC;

-- ── Classement ──────────────────────────────────────────────────────────────
--
-- Rate is scanned / hours PRESENT, not scanned / hours in the day: a half-day
-- operator is not a slow one. We have no attendance system, so presence is the
-- span between an operator's first and last scan today — the only honest proxy
-- available. Floored at 30 min so a single scan cannot read as an infinite rate.

CREATE OR REPLACE FUNCTION public.get_warehouse_leaderboard(p_market_id UUID DEFAULT NULL)
RETURNS TABLE (
  actor_id      UUID,
  full_name     TEXT,
  scanned       INT,
  first_scan_at TIMESTAMPTZ,
  last_scan_at  TIMESTAMPTZ,
  active_hours  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz    TEXT := public.warehouse_market_tz(p_market_id);
  v_today TIMESTAMPTZ;
BEGIN
  v_today := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1))::TEXT,
    COUNT(*)::INT,
    MIN(il.created_at),
    MAX(il.created_at),
    GREATEST(
      ROUND(EXTRACT(EPOCH FROM (MAX(il.created_at) - MIN(il.created_at))) / 3600.0, 2),
      0.5
    )::NUMERIC
  FROM inventory_log il
  JOIN users u    ON u.id = il.actor_id
  JOIN products p ON p.id = il.product_id
  WHERE il.reason = 'scanned'
    AND il.created_at >= v_today
    AND (p_market_id IS NULL OR p.market_id = p_market_id)
  GROUP BY u.id, u.full_name, u.email
  ORDER BY 3 DESC, 2 ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_leaderboard(UUID) TO PUBLIC;

-- ── Retours ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_warehouse_returns_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
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

  -- Return rate = returned / (delivered + returned) over the window. Both are
  -- terminal, so terminal_at is the honest clock — not created_at, which would
  -- mix orders still in flight into the denominator.
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'returned') / COUNT(*), 1) END
  INTO v_rate_28
  FROM orders
  WHERE status IN ('delivered', 'returned')
    AND terminal_at >= now() - INTERVAL '28 days'
    AND archived_at IS NULL
    AND (p_market_id IS NULL OR market_id = p_market_id);

  SELECT CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'returned') / COUNT(*), 1) END
  INTO v_rate_prev_28
  FROM orders
  WHERE status IN ('delivered', 'returned')
    AND terminal_at >= now() - INTERVAL '56 days'
    AND terminal_at <  now() - INTERVAL '28 days'
    AND archived_at IS NULL
    AND (p_market_id IS NULL OR market_id = p_market_id);

  -- Four weekly points, oldest first (S-4 → S-1), for the sparkline.
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
    'queue_count',        COALESCE(v_queue_n, 0),
    'queue_value',        COALESCE(v_queue_val, 0),
    'oldest_days',        COALESCE(v_oldest_days, 0),
    'done_today',         COALESCE(v_done_n, 0),
    'done_today_value',   COALESCE(v_done_val, 0),
    'restocked_today',    COALESCE(v_restocked, 0),
    'depreciated_today',  COALESCE(v_depreciated, 0),
    'depreciated_units',  COALESCE(v_dep_units_28, 0),
    'depreciated_value',  COALESCE(v_dep_value_28, 0),
    'rate_28d',           v_rate_28,
    'rate_prev_28d',      v_rate_prev_28,
    'weekly',             COALESCE(v_weekly, '[]'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_returns_stats(UUID) TO PUBLIC;
