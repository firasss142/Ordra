-- 20260424_operator_prep_stats.sql
-- Adds RPC get_operator_prep_stats(p_actor_id) that returns today's
-- label-print count, scan count, and average cycle time for the operator.
-- "Today" = since local midnight in the market's timezone (or UTC if unknown).

CREATE OR REPLACE FUNCTION get_operator_prep_stats(p_actor_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market_id    UUID;
  v_tz           TEXT;
  v_midnight     TIMESTAMPTZ;
  v_labels       INT;
  v_scanned      INT;
  v_avg_ms       NUMERIC;
  v_avg_seconds  INT;
BEGIN
  -- Resolve actor's market and timezone
  SELECT u.market_id, COALESCE(m.timezone, 'UTC')
  INTO v_market_id, v_tz
  FROM users u
  LEFT JOIN markets m ON m.id = u.market_id
  WHERE u.id = p_actor_id;

  -- Local midnight (start of today in the market's timezone)
  v_midnight := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  -- Count labels printed today by this operator
  SELECT COUNT(*)::INT INTO v_labels
  FROM label_prints
  WHERE printed_by = p_actor_id
    AND created_at >= v_midnight;

  -- Count orders scanned out today by this operator
  SELECT COUNT(*)::INT INTO v_scanned
  FROM inventory_log
  WHERE actor_id = p_actor_id
    AND reason = 'scanned'
    AND created_at >= v_midnight;

  -- Average cycle time: time between label print and scan per order today.
  -- Cap individual cycles at 1 hour (3600 s) to exclude lunch-break outliers.
  SELECT AVG(LEAST(EXTRACT(EPOCH FROM (il.created_at - lp.created_at)), 3600))
  INTO v_avg_ms
  FROM inventory_log il
  JOIN (
    SELECT DISTINCT ON (order_id) order_id, created_at
    FROM label_prints
    WHERE printed_by = p_actor_id
      AND created_at >= v_midnight
    ORDER BY order_id, created_at ASC
  ) lp ON lp.order_id = il.order_id
  WHERE il.actor_id = p_actor_id
    AND il.reason = 'scanned'
    AND il.created_at >= v_midnight;

  v_avg_seconds := COALESCE(v_avg_ms::INT, 0);

  RETURN json_build_object(
    'labels_printed_today', COALESCE(v_labels, 0),
    'orders_scanned_today', COALESCE(v_scanned, 0),
    'avg_cycle_seconds',    v_avg_seconds
  );
END;
$$;

-- Index to support today-filter on inventory_log by actor
CREATE INDEX IF NOT EXISTS idx_inventory_log_actor_created
  ON inventory_log (actor_id, created_at DESC)
  WHERE reason = 'scanned';

-- Index to support today-filter on label_prints by operator
CREATE INDEX IF NOT EXISTS idx_label_prints_printed_by_created
  ON label_prints (printed_by, created_at DESC);
