-- ============================================================
-- 20260908000001_agent_day_detail_rpc.sql
-- get_agent_day_detail — one agent, one market-local day.
--
-- WHY: the Présence heatmap on /team/performance looks like a calendar but its
-- click handler sat on the <tr>, so every cell opened the same drawer showing
-- "today" (get_team_live, hardcoded to now()) plus the page-wide period. The day
-- you clicked changed nothing. This RPC is the missing per-day payload.
--
-- WHAT IS NEW HERE, beyond re-scoping get_team_performance to a single day:
--
--   1. UPLOAD IS THE OUTCOME, NOT CONFIRMATION. A confirmation that never
--      reaches the carrier is not revenue. Every "uploaded" figure below counts
--      orders the agent CONFIRMED on p_day that have since reached the carrier
--      (uploaded or beyond) — attribution by whose confirmation it was, outcome
--      read as of now. Measured on real data this gap is large and invisible
--      elsewhere: 13 confirmations on one day, 7 shipped, 5 killed afterwards.
--
--   2. REAL CALL ATTEMPTS ARE THE NOTE, NOT THE STATUS. order_history rows are
--      NOT 1:1 with dials — an agent editing a phone number or a manager
--      reassigning writes a row with status_to unchanged. The sole writer of a
--      genuine dial outcome is the no-answer RPC family
--      (20260827000002_stamp_next_retry_slot.sql and successors), which always
--      stamps a note of the form 'Tentative N - …' / 'Auto-rejete - tentative N'
--      where N is the true attempts_count. Cadence therefore filters on that
--      note, never on status_to IN ('attempt_1','attempt_2','attempt_3').
--      N routinely exceeds 3: the enum is a capped display tier, the counter is
--      not, and max_call_attempts is 8 in Libya.
--
--   3. THE QUEUE IS RECONSTRUCTED AT END OF DAY, not read live. For each order
--      the agent touched that day, its status as of v_to is the last history row
--      before v_to, and attempts used is the highest 'Tentative N' before v_to.
--      That is what makes a past day answerable at all.
--
-- TIME: p_day is a MARKET-LOCAL day (p_tz), half-open [v_from, v_to).
-- ACTIVE MINUTES: distinct 10-minute buckets × 10 — the same honest lower bound
-- used everywhere else on these pages. There is no session table.
-- JUDGEMENT stays in TypeScript (src/lib/team/goals.ts + day-view.ts); SQL
-- supplies counts only.
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_day_detail(
  p_market_id UUID,
  p_agent_id  UUID,
  p_day       DATE,
  p_tz        TEXT DEFAULT 'Africa/Tunis'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_role           TEXT;
  v_caller_market  UUID;
  v_market         UUID;
  v_from           TIMESTAMPTZ;
  v_to             TIMESTAMPTZ;
  v_series_from    TIMESTAMPTZ;
  v_goal_daily     NUMERIC;
  v_goal_rate      NUMERIC;
  v_goal_cph       NUMERIC;
  v_max_attempts   INT;
  v_result         JSONB;
BEGIN
  v_role := get_user_role();
  v_caller_market := get_user_market_id();
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_caller_market THEN
      RETURN '{}'::jsonb;
    END IF;
    v_market := v_caller_market;
  ELSE
    v_market := p_market_id;
  END IF;
  IF v_market IS NULL OR p_agent_id IS NULL OR p_day IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  v_from        := (p_day::timestamp) AT TIME ZONE p_tz;
  v_to          := ((p_day + 1)::timestamp) AT TIME ZONE p_tz;
  -- 14 local days ending on p_day, for the rhythm sparkline.
  v_series_from := ((p_day - 13)::timestamp) AT TIME ZONE p_tz;

  SELECT (value #>> '{}')::numeric INTO v_goal_daily FROM settings WHERE market_id = v_market AND key = 'goal_daily_treated';
  SELECT (value #>> '{}')::numeric INTO v_goal_rate  FROM settings WHERE market_id = v_market AND key = 'goal_min_rate';
  SELECT (value #>> '{}')::numeric INTO v_goal_cph   FROM settings WHERE market_id = v_market AND key = 'goal_conf_per_hour';
  -- max_call_attempts is stored as {"value": N}; the goal_* keys are bare scalars.
  SELECT COALESCE((value ->> 'value')::numeric, (value #>> '{}')::numeric)
    INTO v_max_attempts FROM settings WHERE market_id = v_market AND key = 'max_call_attempts';
  v_goal_daily   := COALESCE(v_goal_daily, 12);
  v_goal_rate    := COALESCE(v_goal_rate, 40);
  v_goal_cph     := COALESCE(v_goal_cph, 3);
  v_max_attempts := COALESCE(v_max_attempts, 3);

  WITH
  agent AS (
    SELECT u.id, u.full_name, u.avatar_url
    FROM users u
    WHERE u.id = p_agent_id AND u.market_id = v_market AND u.role = 'agent' AND u.deleted_at IS NULL
  ),
  -- Everything this agent did on this local day.
  hist AS (
    SELECT h.order_id, h.status_to, h.created_at,
      COALESCE(o.product_id::text, o.product_name, '(inconnu)') AS product_key,
      COALESCE(pr.name, o.product_name, '(inconnu)') AS product_name,
      pr.image_url,
      o.rejection_reason::text AS rejection_reason
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    LEFT JOIN products pr ON pr.id = o.product_id
    WHERE h.market_id = v_market
      AND h.actor_id = p_agent_id
      AND h.created_at >= v_from AND h.created_at < v_to
  ),
  touched AS (SELECT DISTINCT order_id FROM hist),
  -- Orders confirmed BY THIS AGENT on this day, and where each ended up.
  conf_fate AS (
    SELECT
      count(*) FILTER (WHERE o.status IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered','returned')) AS uploaded,
      count(*) FILTER (WHERE o.status IN ('confirmed','dispatch_scheduled')) AS stuck_confirmed,
      count(*) FILTER (WHERE o.status IN ('cancelled','deleted','rejected')) AS lost_after_confirm
    FROM (SELECT DISTINCT order_id FROM hist WHERE status_to = 'confirmed') c
    JOIN orders o ON o.id = c.order_id
  ),
  totals AS (
    SELECT
      count(*) FILTER (WHERE status_to IN ('attempt_1','attempt_2','attempt_3','confirmed','rejected','callback_scheduled')) AS calls,
      count(DISTINCT order_id) AS touched,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'rejected') AS rejected,
      count(DISTINCT floor(extract(epoch FROM created_at) / 600)) * 10 AS active_minutes
    FROM hist
  ),
  hourly AS (
    SELECT extract(hour FROM (created_at AT TIME ZONE p_tz))::int AS hr,
      count(DISTINCT floor(extract(epoch FROM created_at) / 600)) * 10 AS active_minutes,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist GROUP BY 1
  ),
  prod AS (
    SELECT product_key, max(product_name) AS product_name, max(image_url) AS image_url,
      count(*) FILTER (WHERE status_to IN ('attempt_1','attempt_2','attempt_3','confirmed','rejected','callback_scheduled')) AS calls,
      count(DISTINCT order_id) AS touched,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist GROUP BY product_key
  ),
  prod_uploaded AS (
    SELECT h.product_key, count(DISTINCT h.order_id) AS uploaded
    FROM hist h JOIN orders o ON o.id = h.order_id
    WHERE h.status_to = 'confirmed'
      AND o.status IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered','returned')
    GROUP BY h.product_key
  ),
  motifs AS (
    SELECT COALESCE(rejection_reason, 'unknown') AS reason, count(DISTINCT order_id) AS n
    FROM hist WHERE status_to = 'rejected' GROUP BY 1
  ),
  -- ── real dial attempts (note-stamped), full history of the touched orders ──
  att AS (
    SELECT h.order_id, h.created_at,
      (regexp_match(h.note, 'tentative (\d+)', 'i'))[1]::int AS n
    FROM order_history h
    JOIN touched t ON t.order_id = h.order_id
    WHERE h.actor_id = p_agent_id
      AND h.note ~* '^(Tentative \d+|Auto-rejete)'
  ),
  att_gap AS (
    SELECT order_id, n, created_at,
      round(extract(epoch FROM (created_at - lag(created_at) OVER (PARTITION BY order_id ORDER BY created_at))) / 60)::int AS gap_min
    FROM att
  ),
  -- Only the follow-ups that landed on p_day and had a previous attempt to measure against.
  att_day AS (
    SELECT * FROM att_gap
    WHERE created_at >= v_from AND created_at < v_to AND gap_min IS NOT NULL
  ),
  cad AS (
    SELECT
      count(*) AS judged,
      count(*) FILTER (WHERE gap_min > 120) AS late,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min)::int AS median_gap_min,
      count(*) FILTER (WHERE gap_min <= 120) AS tier_ok,
      count(*) FILTER (WHERE gap_min > 120 AND gap_min <= 1440) AS tier_late,
      count(*) FILTER (WHERE gap_min > 1440) AS tier_abandoned
    FROM att_day
  ),
  late_hours AS (
    SELECT extract(hour FROM (created_at AT TIME ZONE p_tz))::int AS hr, count(*) AS n
    FROM att_day WHERE gap_min > 120 GROUP BY 1
  ),
  cad_orders AS (
    SELECT ad.order_id, o.external_id, o.status::text AS status_now,
      COALESCE(pr.name, o.product_name, '(inconnu)') AS product_name,
      max(ad.gap_min) AS worst_gap_min,
      jsonb_agg(jsonb_build_object('n', ad.n, 'gap_min', ad.gap_min, 'late', ad.gap_min > 120) ORDER BY ad.created_at) AS attempts
    FROM att_day ad
    JOIN orders o ON o.id = ad.order_id
    LEFT JOIN products pr ON pr.id = o.product_id
    GROUP BY ad.order_id, o.external_id, o.status, pr.name, o.product_name
  ),
  -- ── queue as it stood at the END of that day ──
  eod AS (
    SELECT DISTINCT ON (h.order_id) h.order_id, h.status_to
    FROM order_history h JOIN touched t ON t.order_id = h.order_id
    WHERE h.created_at < v_to
    ORDER BY h.order_id, h.created_at DESC
  ),
  eod_att AS (
    SELECT h.order_id, max((regexp_match(h.note, 'tentative (\d+)', 'i'))[1]::int) AS used
    FROM order_history h JOIN touched t ON t.order_id = h.order_id
    WHERE h.created_at < v_to AND h.note ~* '^(Tentative \d+|Auto-rejete)'
    GROUP BY h.order_id
  ),
  queue AS (
    SELECT e.order_id,
      GREATEST(0, v_max_attempts - COALESCE(ea.used, 0))::int AS attempts_left
    FROM eod e
    LEFT JOIN eod_att ea ON ea.order_id = e.order_id
    WHERE e.status_to IN ('pending','attempt_1','attempt_2','attempt_3','callback_scheduled')
  ),
  queue_buckets AS (SELECT attempts_left, count(*) AS n FROM queue GROUP BY 1),
  eod_roll AS (
    SELECT
      count(*) FILTER (WHERE status_to IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered','returned')) AS uploaded,
      count(*) FILTER (WHERE status_to = 'rejected') AS rejected
    FROM eod
  ),
  -- ── 14-day rhythm series ──
  series_hist AS (
    SELECT h.order_id, h.status_to, h.created_at, (h.created_at AT TIME ZONE p_tz)::date AS d
    FROM order_history h
    WHERE h.market_id = v_market AND h.actor_id = p_agent_id
      AND h.created_at >= v_series_from AND h.created_at < v_to
  ),
  series_base AS (
    SELECT d,
      count(DISTINCT floor(extract(epoch FROM created_at) / 600)) * 10 AS active_minutes,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM series_hist GROUP BY d
  ),
  series_up AS (
    SELECT sh.d, count(DISTINCT sh.order_id) AS uploaded
    FROM series_hist sh JOIN orders o ON o.id = sh.order_id
    WHERE sh.status_to = 'confirmed'
      AND o.status IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered','returned')
    GROUP BY sh.d
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'tz', p_tz,
    'market_id', v_market,
    'agent', (SELECT jsonb_build_object('agent_id', id, 'name', full_name, 'avatar_url', avatar_url) FROM agent),
    'targets', jsonb_build_object(
      'daily_treated', v_goal_daily,
      'min_rate', v_goal_rate,
      'conf_per_hour', v_goal_cph,
      'max_attempts', v_max_attempts),
    'totals', (
      SELECT jsonb_build_object(
        'calls', t.calls, 'touched', t.touched, 'treated', t.treated,
        'confirmed', t.confirmed, 'rejected', t.rejected, 'active_minutes', t.active_minutes,
        'uploaded', COALESCE(cf.uploaded, 0),
        'stuck_confirmed', COALESCE(cf.stuck_confirmed, 0),
        'lost_after_confirm', COALESCE(cf.lost_after_confirm, 0))
      FROM totals t CROSS JOIN conf_fate cf
    ),
    'hourly', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'hour', hr, 'active_minutes', active_minutes, 'treated', treated, 'confirmed', confirmed) ORDER BY hr), '[]'::jsonb) FROM hourly),
    'late_hours', (SELECT COALESCE(jsonb_object_agg(hr::text, n), '{}'::jsonb) FROM late_hours),
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', p.product_key, 'name', p.product_name, 'image_url', p.image_url,
        'calls', p.calls, 'touched', p.touched, 'treated', p.treated, 'confirmed', p.confirmed,
        'uploaded', COALESCE(pu.uploaded, 0)) ORDER BY p.touched DESC), '[]'::jsonb)
      FROM prod p LEFT JOIN prod_uploaded pu ON pu.product_key = p.product_key),
    'motifs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM motifs),
    'cadence', (
      SELECT jsonb_build_object(
        'judged', COALESCE(c.judged, 0), 'late', COALESCE(c.late, 0),
        'median_gap_min', c.median_gap_min,
        'tiers', jsonb_build_object('ok', COALESCE(c.tier_ok,0), 'late', COALESCE(c.tier_late,0), 'abandoned', COALESCE(c.tier_abandoned,0)),
        'orders', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'order_id', order_id, 'external_id', external_id, 'product_name', product_name,
            'status_now', status_now, 'worst_gap_min', worst_gap_min, 'attempts', attempts)
          ORDER BY worst_gap_min DESC), '[]'::jsonb) FROM cad_orders))
      FROM cad c
    ),
    'queue_end_of_day', (
      SELECT jsonb_build_object(
        'open', (SELECT count(*) FROM queue),
        'uploaded', (SELECT uploaded FROM eod_roll),
        'rejected', (SELECT rejected FROM eod_roll),
        'by_attempts_left', (SELECT COALESCE(jsonb_agg(jsonb_build_object('attempts_left', attempts_left, 'n', n) ORDER BY attempts_left), '[]'::jsonb) FROM queue_buckets))
    ),
    'series', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', b.d, 'active_minutes', b.active_minutes, 'treated', b.treated,
        'confirmed', b.confirmed, 'uploaded', COALESCE(u.uploaded, 0)) ORDER BY b.d), '[]'::jsonb)
      FROM series_base b LEFT JOIN series_up u ON u.d = b.d)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_agent_day_detail(UUID, UUID, DATE, TEXT) IS
  'One agent, one market-local day: totals (incl. upload outcome of that day''s confirmations), hourly activity, per-product breakdown, rejection motifs, real call-attempt cadence (note-stamped, 2h SLA), the queue reconstructed as it stood at end of day, and a 14-day rhythm series. One round-trip; SECURITY DEFINER; market isolation in-function. Judgement lives in src/lib/team/day-view.ts.';

GRANT EXECUTE ON FUNCTION get_agent_day_detail(UUID, UUID, DATE, TEXT) TO authenticated;
