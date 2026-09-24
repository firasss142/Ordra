-- ============================================================
-- 20260823000002_dashboard_queues_rpc.sql
-- Live confirmation-queue counts + aging, split out of get_dashboard_health.
--
-- WHY THE SPLIT: the dashboard has two refresh rhythms and the old design fused
-- them into one SWR key, so every order write re-ran the whole financial
-- rollup. Queues are "maintenant" and want a ~60s cadence; money/funnel/trend
-- are period-scoped and change slowly (5 min is plenty). Pointing the realtime
-- mutate() at this cheap function instead of the full rollup is what stops
-- webhook intake from continuously recomputing the P&L.
--
-- get_dashboard_health still returns queues so server-side first paint needs
-- exactly one round-trip; this function only serves the client's live refresh.
--
-- Same SECURITY DEFINER + market-isolation guard as get_dashboard_health.
-- ============================================================

CREATE OR REPLACE FUNCTION get_dashboard_queues(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_caller_role   TEXT;
  v_caller_market UUID;
  v_scope_market  UUID;
  v_result        JSONB;
BEGIN
  v_caller_role   := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_caller_market THEN
      RETURN '{}'::jsonb;
    END IF;
    v_scope_market := v_caller_market;
  ELSE
    v_scope_market := p_market_id;
  END IF;

  WITH queues AS (
    SELECT
      b.bucket,
      b.ord,
      COUNT(o.id) AS count,
      MAX(EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0) AS oldest_hours,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0
      ) AS median_hours
    FROM (VALUES
      ('new', 1), ('assigned', 2), ('attempts', 3),
      ('callback', 4), ('confirmed', 5), ('uploaded', 6)
    ) AS b(bucket, ord)
    LEFT JOIN orders o
      ON (v_scope_market IS NULL OR o.market_id = v_scope_market)
     AND CASE b.bucket
           WHEN 'new'       THEN o.status IN ('pending','new','assigned') AND o.assigned_to IS NULL
           WHEN 'assigned'  THEN o.status IN ('pending','new','assigned') AND o.assigned_to IS NOT NULL
           WHEN 'attempts'  THEN o.status IN ('attempt_1','attempt_2','attempt_3')
           WHEN 'callback'  THEN o.status = 'callback_scheduled'
           WHEN 'confirmed' THEN o.status IN ('confirmed','dispatch_scheduled')
           WHEN 'uploaded'  THEN o.status IN ('uploaded','scanned')
         END
    GROUP BY b.bucket, b.ord
  )
  SELECT jsonb_build_object(
    'queues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'count', count,
        'oldestHours', ROUND(oldest_hours::numeric, 1),
        'medianHours', ROUND(median_hours::numeric, 1)) ORDER BY ord) FROM queues), '[]'::jsonb)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_dashboard_queues(UUID) IS
  'Live confirmation-queue counts and aging for /dashboard. Cheap, 60s refresh cadence; the realtime mutate() targets this rather than the full get_dashboard_health rollup.';

GRANT EXECUTE ON FUNCTION get_dashboard_queues(UUID) TO authenticated;
