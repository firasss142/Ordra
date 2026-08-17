-- ============================================================
-- 20260910000001_agent_day_funnel.sql
-- get_agent_day_detail v2 — the day as one closed funnel.
--
-- WHY: the drawer showed four goal cards plus an end-of-day queue histogram.
-- Between them they answered "was the target met?" but never the question a
-- manager actually opens a day to ask: of everything in this agent's hands,
-- how much did they attempt, and what came out? This replaces both blocks with
-- one funnel — assigned → attempted → uploaded / rejected — so three new
-- figures are needed and one existing figure had to be corrected.
--
--   1. NEW: `assigned` — the day's workload pool, reconstructed. order_history
--      records WHEN an assignment happened but never WHO it went to (actor_id on
--      a 'Reassigned to agent' row is the manager doing the assigning), so past
--      ownership is not directly readable. It IS derivable: orders.assigned_to
--      is today's holder, and if no assignment event touched an order at or
--      after v_to then today's holder is also the holder at v_to. Measured on
--      production, only 10 of 326 candidate orders had a later assignment event,
--      so the reconstruction covers ~97 % and degrades by omission, never by
--      inventing ownership. Anything the agent actually acted on that day is
--      unioned in unconditionally — acting on an order proves it was theirs.
--      The pool is then narrowed to orders that were WORKABLE that day: open at
--      the start of it, or created during it, or touched.
--
--   2. NEW: `attempted` — distinct orders that got at least one real call.
--      `assigned - attempted` is the coaching number: orders that sat in the
--      queue all day without a single dial. On production days that gap runs
--      from 11 (8 Aug: 59 assigned, 48 attempted) down to 0 (16 Aug: 42/42).
--
--   3. CORRECTED: `calls` was counting field edits as calls. It filtered on
--      status_to IN ('attempt_1',…,'confirmed','rejected','callback_scheduled'),
--      but editing a phone number writes a row whose status_to is unchanged and
--      therefore still matches. On 11 Aug that inflated 62 real calls to 86: of
--      165 rows that day, 103 were field edits (JSON-shaped note) and 11 were
--      carrier uploads. A call is now exactly one of:
--        · a note-stamped dial — 'Tentative N …' / 'Auto-rejete …', the no-answer
--          RPC family being the only writer of genuine dial outcomes; or
--        · a row landing on confirmed / rejected / callback_scheduled WITHOUT
--          such a note — a call that was answered. The note test comes first so
--          an auto-reject is never counted twice.
--      Applied to per-product `calls` too, which had the same flaw.
--
-- The funnel closes exactly, by construction:
--   attempted = uploaded + (confirmed - uploaded) + rejected + (attempted - treated)
--   assigned  = attempted + not_attempted
-- Judgement still lives in src/lib/team/day-view.ts; SQL supplies counts only.
-- Everything else in the payload is unchanged from 20260908000001.
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
    SELECT h.order_id, h.status_to, h.created_at, h.note,
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
  -- One row per real call: an unanswered/auto-closed dial, or an answered one.
  -- The note test is first so an auto-reject is counted once, not twice.
  call_ev AS (
    SELECT order_id, product_key FROM hist
    WHERE note ~* '^(Tentative \d+|Auto-rejete)'
       OR (status_to IN ('confirmed','rejected','callback_scheduled')
           AND (note IS NULL OR note !~* '^(Tentative \d+|Auto-rejete)'))
  ),
  -- ── the day's workload pool ──
  -- Candidates: provably hers (she acted on it), or hers today with no
  -- assignment event since v_to, which makes today's holder the holder then.
  pool_cand AS (
    SELECT o.id, o.created_at
    FROM orders o
    WHERE o.market_id = v_market
      AND o.created_at < v_to
      AND (
        EXISTS (SELECT 1 FROM touched t WHERE t.order_id = o.id)
        OR (
          o.assigned_to = p_agent_id
          AND NOT EXISTS (
            SELECT 1 FROM order_history h
            WHERE h.order_id = o.id
              AND h.created_at >= v_to
              AND h.note ~* '(assigned to agent|unassigned|returned to pool|self-assigned|r.assign|retour au pool|pris en charge)'
          )
        )
      )
  ),
  -- Status of each candidate as the day began.
  pool_sod AS (
    SELECT DISTINCT ON (h.order_id) h.order_id, h.status_to
    FROM order_history h JOIN pool_cand c ON c.id = h.order_id
    WHERE h.created_at < v_from
    ORDER BY h.order_id, h.created_at DESC
  ),
  -- Workable that day: open when it started, or it arrived during it, or she
  -- touched it (which proves it was workable whatever the reconstruction says).
  pool AS (
    SELECT c.id
    FROM pool_cand c
    LEFT JOIN pool_sod s ON s.order_id = c.id
    WHERE EXISTS (SELECT 1 FROM touched t WHERE t.order_id = c.id)
       OR c.created_at >= v_from
       OR COALESCE(s.status_to::text, 'pending')
            IN ('pending','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','dispatch_scheduled')
  ),
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
      (SELECT count(*) FROM call_ev) AS calls,
      (SELECT count(DISTINCT order_id) FROM call_ev) AS attempted,
      (SELECT count(*) FROM pool) AS assigned,
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
    SELECT h.product_key, max(h.product_name) AS product_name, max(h.image_url) AS image_url,
      count(DISTINCT h.order_id) AS touched,
      count(DISTINCT h.order_id) FILTER (WHERE h.status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT h.order_id) FILTER (WHERE h.status_to = 'confirmed') AS confirmed
    FROM hist h GROUP BY h.product_key
  ),
  prod_calls AS (
    SELECT product_key, count(*) AS calls, count(DISTINCT order_id) AS attempted
    FROM call_ev GROUP BY product_key
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
        'calls', t.calls, 'attempted', t.attempted, 'assigned', t.assigned,
        'touched', t.touched, 'treated', t.treated,
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
        'calls', COALESCE(pc.calls, 0), 'attempted', COALESCE(pc.attempted, 0),
        'touched', p.touched, 'treated', p.treated, 'confirmed', p.confirmed,
        'uploaded', COALESCE(pu.uploaded, 0)) ORDER BY p.touched DESC), '[]'::jsonb)
      FROM prod p
      LEFT JOIN prod_calls pc ON pc.product_key = p.product_key
      LEFT JOIN prod_uploaded pu ON pu.product_key = p.product_key),
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
  'One agent, one market-local day, as a closed funnel: assigned (workload pool reconstructed from orders.assigned_to plus the assignment-event log) → attempted (distinct orders that got a real call) → uploaded / rejected. Also hourly activity, per-product breakdown, rejection motifs, call-attempt cadence (note-stamped, 2h SLA), the queue as it stood at end of day, and a 14-day rhythm series. A "call" is a note-stamped dial or a row landing on confirmed/rejected/callback_scheduled — never a field edit. One round-trip; SECURITY DEFINER; market isolation in-function. Judgement lives in src/lib/team/day-view.ts.';

GRANT EXECUTE ON FUNCTION get_agent_day_detail(UUID, UUID, DATE, TEXT) TO authenticated;
