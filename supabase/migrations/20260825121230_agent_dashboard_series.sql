-- Entrepôt mobile — the four figures the agent dashboard needs.
--
-- Each one exists because a mockup card asks for it and nothing could answer:
--
--   hourly[24]              the cadence sparkline on the summary strip
--   trend.handed            the "prêts à remettre" card's bars
--   avg_processing_minutes  the returns footer, "temps de traitement moyen"
--   returned_at             the timestamp on every returns card
--
-- All additive, all read-only. Nothing writes; nothing touches order_history
-- or inventory_log, which stay append-only.

-- ── The operator's cadence, hour by hour ────────────────────────────────────
--
-- 24 buckets in the MARKET's day, not UTC: an agent in Tripoli looking at
-- "this morning" means their morning. Returned as a plain array so the
-- sparkline can draw it without another shape to agree on.

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
  v_hourly      INT[];
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

  -- One bucket per hour of the local day, zero-filled, so the sparkline is a
  -- flat line on a quiet day rather than a gap.
  SELECT ARRAY(
    SELECT COALESCE((
      SELECT COUNT(*)::INT FROM inventory_log il
       WHERE il.actor_id = p_actor_id
         AND il.reason = 'scanned'
         AND il.created_at >= v_midnight + make_interval(hours => g.h)
         AND il.created_at <  v_midnight + make_interval(hours => g.h + 1)
    ), 0)
    FROM generate_series(0, 23) AS g(h)
  ) INTO v_hourly;

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
    'rate_per_hour',        v_rate,
    'hourly',               COALESCE(v_hourly, ARRAY[]::INT[])
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operator_prep_stats(UUID) TO PUBLIC;

-- ── Handovers on the trend ──────────────────────────────────────────────────
--
-- scanned / returned / damaged are stock movements and live in inventory_log.
-- A handover moves no stock — it is a status transition — so it comes from
-- order_history and the two are joined on the day.

DROP FUNCTION IF EXISTS public.get_warehouse_trend(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_warehouse_trend(
  p_market_id uuid,
  p_from_date timestamptz,
  p_to_date   timestamptz
)
RETURNS TABLE(day date, scanned bigint, returned bigint, damaged bigint, handed bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH moves AS (
    SELECT date_trunc('day', il.created_at AT TIME ZONE 'UTC')::date AS day,
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
  ), handovers AS (
    SELECT date_trunc('day', h.created_at AT TIME ZONE 'UTC')::date AS day,
           COUNT(*)::bigint AS handed
    FROM order_history h
    WHERE h.status_to = 'dispatched'
      AND h.created_at >= p_from_date
      AND h.created_at <  p_to_date
      AND (p_market_id IS NULL OR h.market_id = p_market_id)
    GROUP BY 1
  )
  SELECT COALESCE(m.day, o.day),
         COALESCE(m.scanned, 0),
         COALESCE(m.returned, 0),
         COALESCE(m.damaged, 0),
         COALESCE(o.handed, 0)
  FROM moves m
  FULL OUTER JOIN handovers o ON o.day = m.day
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_trend(uuid, timestamptz, timestamptz) TO authenticated;

-- ── How long a return actually takes ────────────────────────────────────────
--
-- Measured from the moment the parcel was marked `to_be_returned` to the
-- moment somebody decided. The SAMPLE ships with it, for the same reason the
-- return rate carries one: today this market has processed three returns in
-- 28 days, averaging 115 DAYS each. That is a true and useful figure, and it
-- is also not a "12 minutes" the mockup implies — a screen that prints an
-- average without its sample invites the reader to trust three data points.

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
  v_avg_minutes   BIGINT;
  v_processed_n   INT;
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

  -- How long a return actually takes, from the moment it was marked coming
  -- back to the moment somebody decided. The SAMPLE ships with it for the
  -- same reason the rate above carries one: this market has processed three
  -- returns in 28 days, averaging 115 DAYS each. True, useful, and nothing
  -- like the "12 minutes" the mockup implies — an average printed without
  -- its sample invites the reader to trust three data points.
  SELECT COUNT(*)::INT,
         ROUND(AVG(EXTRACT(EPOCH FROM (h.created_at - prev.created_at)) / 60.0))::BIGINT
  INTO v_processed_n, v_avg_minutes
  FROM order_history h
  JOIN LATERAL (
    SELECT MAX(p.created_at) AS created_at
    FROM order_history p
    WHERE p.order_id = h.order_id
      AND p.status_to = 'to_be_returned'
      AND p.created_at <= h.created_at
  ) prev ON prev.created_at IS NOT NULL
  WHERE h.status_from = 'to_be_returned'
    AND h.status_to IN ('returned', 'received')
    AND h.created_at >= now() - INTERVAL '28 days'
    AND (p_market_id IS NULL OR h.market_id = p_market_id);

  RETURN json_build_object(
    'queue_count',            COALESCE(v_queue_n, 0),
    'queue_value',            COALESCE(v_queue_val, 0),
    'oldest_days',            COALESCE(v_oldest_days, 0),
    'done_today',             COALESCE(v_done_n, 0),
    'done_today_value',       COALESCE(v_done_val, 0),
    'restocked_today',        COALESCE(v_restocked, 0),
    'depreciated_today',      COALESCE(v_depreciated, 0),
    'depreciated_units',      COALESCE(v_dep_units_28, 0),
    'depreciated_value',      COALESCE(v_dep_value_28, 0),
    'rate_28d',               v_rate_28,
    'rate_prev_28d',          v_rate_prev_28,
    'sample_28d',             COALESCE(v_sample_28, 0),
    'sample_prev_28d',        COALESCE(v_sample_prev, 0),
    'weekly',                 COALESCE(v_weekly, '[]'::JSON),
    'avg_processing_minutes', v_avg_minutes,
    'processed_sample',       COALESCE(v_processed_n, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_returns_stats(UUID) TO PUBLIC;

-- ── When the parcel came back ───────────────────────────────────────────────
--
-- Every queued return has a `to_be_returned` history row (verified: 50 of 50),
-- so this is reliable; COALESCE to created_at anyway rather than render a card
-- with no date.

DROP FUNCTION IF EXISTS public.get_to_be_returned_orders(UUID, INTEGER, TIMESTAMPTZ, UUID);

CREATE FUNCTION public.get_to_be_returned_orders(
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
  tracking_number TEXT,
  carrier_sticker_ref TEXT,
  carrier_status_slug TEXT,
  -- When it was marked as coming back. The card's timestamp.
  returned_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    o.tracking_number, o.carrier_sticker_ref, o.carrier_status_slug,
    COALESCE(
      (SELECT MAX(h.created_at) FROM order_history h
        WHERE h.order_id = o.id AND h.status_to::TEXT = 'to_be_returned'),
      o.created_at
    )
  FROM orders o
  WHERE o.status = 'to_be_returned'
    AND o.archived_at IS NULL
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_to_be_returned_orders(UUID, INTEGER, TIMESTAMPTZ, UUID) TO PUBLIC;
