-- ============================================================
-- 20260907000002_team_rpcs.sql
-- Team control room — the two read RPCs behind /team and /team/performance.
--
-- WHY ONE ROUND-TRIP EACH: the old /api/team pulled up to 50 000 order_history
-- rows (twice — current + previous window) into Node and reduced them in JS,
-- paying the per-row RLS subplan 20260822000002 measured at 65× the bypassed
-- cost. Same move as get_dashboard_health: SECURITY DEFINER, market isolation
-- enforced once in-function, all aggregation in SQL, JSONB out.
--
-- WHAT THEY DO NOT DO: judge. Goals (volume / quality / hygiene), streaks,
-- ranking eligibility and coaching suggestions are computed in
-- src/lib/team/goals.ts, which is unit-tested. SQL supplies counts, TS
-- supplies the verdict — one place to change a rule, one place to test it.
--
-- TIME: every "day" and "today" is the MARKET's local day (p_tz). Old code
-- bounded periods in UTC, which split a Tripoli evening shift across two days.
--
-- ACTIVE MINUTES: count of distinct 10-minute buckets containing ≥ 1 timestamped
-- action × 10. An honest lower bound derived from the append-only event log —
-- there is no session table, and this is what "heures actives" means everywhere
-- on these pages.
--
-- Definitions shared by both functions:
--   agent      = users.role='agent' AND is_active AND deleted_at IS NULL
--   presence   = online < 5 min, idle < 30 min, offline otherwise (lib/presence.ts)
--   treated    = DISTINCT orders reaching confirmed OR rejected (never rows —
--                the old TRAITÉES double-counted confirmed→uploaded)
--   touches    = every order-touching action (attempt/confirm/reject/callback),
--                not only "Pas de réponse" clicks
-- ============================================================

-- ------------------------------------------------------------
-- get_team_live: the Salle de contrôle. No period — right now.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_team_live(
  p_market_id UUID,
  p_tz        TEXT DEFAULT 'Africa/Tunis'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_role          TEXT;
  v_caller_market UUID;
  v_market        UUID;
  v_now           TIMESTAMPTZ := now();
  v_day_start     TIMESTAMPTZ;
  v_online_cut    TIMESTAMPTZ := now() - interval '5 minutes';
  v_offline_cut   TIMESTAMPTZ := now() - interval '30 minutes';
  v_goal_daily    NUMERIC;
  v_goal_rate     NUMERIC;
  v_result        JSONB;
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
  IF v_market IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_day_start := date_trunc('day', v_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;

  SELECT (value #>> '{}')::numeric INTO v_goal_daily FROM settings WHERE market_id = v_market AND key = 'goal_daily_treated';
  SELECT (value #>> '{}')::numeric INTO v_goal_rate  FROM settings WHERE market_id = v_market AND key = 'goal_min_rate';
  v_goal_daily := COALESCE(v_goal_daily, 12);
  v_goal_rate  := COALESCE(v_goal_rate, 40);

  WITH
  agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.last_seen_at,
      CASE
        WHEN u.last_seen_at >= v_online_cut  THEN 'online'
        WHEN u.last_seen_at >= v_offline_cut THEN 'idle'
        ELSE 'offline'
      END AS presence
    FROM users u
    WHERE u.role = 'agent' AND u.is_active AND u.deleted_at IS NULL AND u.market_id = v_market
  ),
  -- Live confirmation-phase queue for the market.
  q AS (
    SELECT o.id, o.assigned_to, o.status, o.created_at, o.callback_scheduled_at,
           o.external_id, o.customer_name,
           COALESCE(p.name, o.product_name) AS product_name
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.market_id = v_market
      AND o.status IN ('pending','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','dispatch_scheduled')
  ),
  attempted AS (
    SELECT DISTINCT h.order_id
    FROM order_history h
    WHERE h.market_id = v_market AND h.status_to IN ('attempt_1','attempt_2','attempt_3')
  ),
  qa AS (
    SELECT q.assigned_to AS agent_id,
      count(*) AS total,
      count(*) FILTER (WHERE q.created_at < v_now - interval '24 hours' AND q.status <> 'dispatch_scheduled') AS older_24h,
      count(*) FILTER (WHERE q.status = 'attempt_3') AS exhausted,
      count(*) FILTER (WHERE q.status = 'confirmed') AS confirmed_awaiting,
      count(*) FILTER (WHERE q.status = 'callback_scheduled' AND q.callback_scheduled_at < v_now) AS overdue_callbacks,
      count(*) FILTER (WHERE q.status = 'pending' AND q.created_at < v_now - interval '24 hours'
                         AND NOT EXISTS (SELECT 1 FROM attempted a WHERE a.order_id = q.id)) AS stale_untouched,
      max(extract(epoch FROM (v_now - q.created_at)) / 86400) AS oldest_days
    FROM q WHERE q.assigned_to IS NOT NULL
    GROUP BY q.assigned_to
  ),
  qp AS (
    SELECT q.assigned_to AS agent_id, q.product_name, q.status, count(*) AS n,
           max(extract(epoch FROM (v_now - q.created_at)) / 86400) AS oldest_days
    FROM q WHERE q.assigned_to IS NOT NULL
    GROUP BY 1, 2, 3
  ),
  today AS (
    SELECT h.actor_id AS agent_id,
      count(*) FILTER (WHERE h.status_to IN ('attempt_1','attempt_2','attempt_3','confirmed','rejected','callback_scheduled')) AS touches,
      count(DISTINCT h.order_id) FILTER (WHERE h.status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT h.order_id) FILTER (WHERE h.status_to = 'confirmed') AS confirmed,
      count(DISTINCT floor(extract(epoch FROM h.created_at) / 600)) * 10 AS active_minutes
    FROM order_history h
    WHERE h.market_id = v_market AND h.created_at >= v_day_start
      AND h.actor_id IN (SELECT id FROM agents)
    GROUP BY h.actor_id
  ),
  last_action AS (
    SELECT DISTINCT ON (h.actor_id) h.actor_id AS agent_id, h.status_to, h.created_at,
           o.external_id, o.customer_name
    FROM order_history h
    LEFT JOIN orders o ON o.id = h.order_id
    WHERE h.market_id = v_market AND h.actor_id IN (SELECT id FROM agents)
    ORDER BY h.actor_id, h.created_at DESC
  ),
  tg AS (
    SELECT DISTINCT ON (t.agent_id, t.metric) t.agent_id, t.metric, t.value
    FROM agent_targets t WHERE t.market_id = v_market
    ORDER BY t.agent_id, t.metric, t.created_at DESC
  ),
  exhausted AS (
    SELECT count(*) AS n, max(extract(epoch FROM (v_now - created_at)) / 86400) AS oldest_days
    FROM q WHERE status = 'attempt_3'
  ),
  exhausted_by_agent AS (
    SELECT a.id, a.full_name, count(q.id) AS n
    FROM q JOIN agents a ON a.id = q.assigned_to
    WHERE q.status = 'attempt_3'
    GROUP BY a.id, a.full_name
  ),
  orphan AS (
    SELECT a.id, a.full_name, count(q.id) AS n,
           count(q.id) FILTER (WHERE q.status = 'confirmed') AS confirmed_n
    FROM q JOIN agents a ON a.id = q.assigned_to
    WHERE a.presence = 'offline'
    GROUP BY a.id, a.full_name
  ),
  overdue AS (
    SELECT count(*) AS n, max(extract(epoch FROM (v_now - callback_scheduled_at)) / 3600) AS oldest_hours
    FROM q WHERE status = 'callback_scheduled' AND callback_scheduled_at < v_now
  ),
  never_called AS (
    SELECT count(*) AS n, max(extract(epoch FROM (v_now - q.created_at)) / 3600) AS oldest_hours
    FROM q WHERE q.status = 'pending' AND NOT EXISTS (SELECT 1 FROM attempted a WHERE a.order_id = q.id)
  ),
  blocked AS (
    SELECT q.id, q.external_id, q.customer_name, q.product_name, q.assigned_to, a.full_name AS agent_name,
      CASE WHEN q.status = 'attempt_3' THEN 'exhausted'
           WHEN q.status = 'confirmed' THEN 'confirmed_stuck'
           ELSE 'overdue_callback' END AS kind,
      extract(epoch FROM (v_now - q.created_at)) / 86400 AS age_days,
      q.callback_scheduled_at
    FROM q LEFT JOIN agents a ON a.id = q.assigned_to
    WHERE q.status IN ('attempt_3', 'confirmed')
       OR (q.status = 'callback_scheduled' AND q.callback_scheduled_at < v_now)
  ),
  upcoming AS (
    SELECT q.id, q.external_id, q.customer_name, q.product_name, q.assigned_to, a.full_name AS agent_name, q.callback_scheduled_at
    FROM q LEFT JOIN agents a ON a.id = q.assigned_to
    WHERE q.status = 'callback_scheduled' AND q.callback_scheduled_at >= v_now
    ORDER BY q.callback_scheduled_at
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'computed_at', v_now,
    'tz', p_tz,
    'market_id', v_market,
    'defaults', jsonb_build_object('daily_treated', v_goal_daily, 'min_rate', v_goal_rate),
    'presence', jsonb_build_object(
      'online', (SELECT count(*) FROM agents WHERE presence = 'online'),
      'total',  (SELECT count(*) FROM agents)
    ),
    'tiles', jsonb_build_object(
      'exhausted', jsonb_build_object(
        'count', (SELECT n FROM exhausted),
        'oldest_days', (SELECT round(oldest_days::numeric, 1) FROM exhausted),
        'by_agent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', id, 'name', full_name, 'count', n) ORDER BY n DESC), '[]'::jsonb) FROM exhausted_by_agent)
      ),
      'orphan_queues', jsonb_build_object(
        'count', (SELECT COALESCE(sum(n), 0) FROM orphan),
        'agents_count', (SELECT count(*) FROM orphan),
        'confirmed_never_uploaded', (SELECT COALESCE(sum(confirmed_n), 0) FROM orphan),
        'by_agent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', id, 'name', full_name, 'count', n) ORDER BY n DESC), '[]'::jsonb) FROM orphan)
      ),
      'overdue_callbacks', jsonb_build_object(
        'count', (SELECT n FROM overdue),
        'oldest_hours', (SELECT round(oldest_hours::numeric, 1) FROM overdue)
      ),
      'never_called', jsonb_build_object(
        'count', (SELECT n FROM never_called),
        'oldest_hours', (SELECT round(oldest_hours::numeric, 1) FROM never_called)
      )
    ),
    'blocked_count', (SELECT count(*) FROM blocked),
    'agents', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'name', a.full_name, 'avatar_url', a.avatar_url,
        'last_seen_at', a.last_seen_at, 'presence', a.presence,
        'last_action', CASE WHEN la.agent_id IS NULL THEN NULL ELSE jsonb_build_object(
          'status_to', la.status_to, 'at', la.created_at, 'external_id', la.external_id, 'customer_name', la.customer_name) END,
        'today', jsonb_build_object(
          'touches', COALESCE(t.touches, 0), 'treated', COALESCE(t.treated, 0),
          'confirmed', COALESCE(t.confirmed, 0), 'active_minutes', COALESCE(t.active_minutes, 0)),
        'queue', jsonb_build_object(
          'total', COALESCE(qa.total, 0), 'older_24h', COALESCE(qa.older_24h, 0),
          'exhausted', COALESCE(qa.exhausted, 0), 'confirmed_awaiting', COALESCE(qa.confirmed_awaiting, 0),
          'overdue_callbacks', COALESCE(qa.overdue_callbacks, 0), 'stale_untouched', COALESCE(qa.stale_untouched, 0),
          'oldest_days', round(qa.oldest_days::numeric, 1),
          'by_product', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'product_name', qp.product_name, 'status', qp.status, 'n', qp.n, 'oldest_days', round(qp.oldest_days::numeric, 1)) ORDER BY qp.n DESC), '[]'::jsonb)
            FROM qp WHERE qp.agent_id = a.id)),
        'targets', jsonb_build_object(
          'daily_treated', (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'daily_treated'),
          'min_rate',      (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'min_rate'))
      ) ORDER BY CASE a.presence WHEN 'online' THEN 0 WHEN 'idle' THEN 1 ELSE 2 END, COALESCE(qa.total, 0) DESC, a.full_name), '[]'::jsonb)
      FROM agents a
      LEFT JOIN today t        ON t.agent_id = a.id
      LEFT JOIN qa             ON qa.agent_id = a.id
      LEFT JOIN last_action la ON la.agent_id = a.id
    ),
    'blocked', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', id, 'external_id', external_id, 'customer_name', customer_name, 'product_name', product_name,
        'agent_id', assigned_to, 'agent_name', agent_name, 'kind', kind,
        'age_days', round(age_days::numeric, 1), 'callback_at', callback_scheduled_at
      ) ORDER BY age_days DESC), '[]'::jsonb) FROM blocked
    ),
    'callbacks_upcoming', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', id, 'external_id', external_id, 'customer_name', customer_name, 'product_name', product_name,
        'agent_id', assigned_to, 'agent_name', agent_name, 'callback_at', callback_scheduled_at
      ) ORDER BY callback_scheduled_at), '[]'::jsonb) FROM upcoming
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_team_live(UUID, TEXT) IS
  'Salle de contrôle rollup: presence, live queue tiles, per-agent today counts + queue breakdown, blocked orders, upcoming callbacks. One round-trip; SECURITY DEFINER; market isolation in-function. Goals are judged in lib/team/goals.ts.';

GRANT EXECUTE ON FUNCTION get_team_live(UUID, TEXT) TO authenticated;


-- ------------------------------------------------------------
-- get_team_performance: the period review. Local-day bounded.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_team_performance(
  p_market_id UUID,
  p_from      DATE,
  p_to        DATE,
  p_tz        TEXT DEFAULT 'Africa/Tunis'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_role          TEXT;
  v_caller_market UUID;
  v_market        UUID;
  v_from          TIMESTAMPTZ;
  v_to            TIMESTAMPTZ;
  v_hist_from     TIMESTAMPTZ;
  v_goal_daily    NUMERIC;
  v_goal_rate     NUMERIC;
  v_goal_cph      NUMERIC;
  v_goal_team     NUMERIC;
  v_result        JSONB;
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
  IF v_market IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Half-open [from, to+1) in the market's local time.
  v_from      := (p_from::timestamp) AT TIME ZONE p_tz;
  v_to        := ((p_to + 1)::timestamp) AT TIME ZONE p_tz;
  -- Streaks look back 14 local days ending p_to, independent of the period.
  v_hist_from := LEAST(v_from, ((p_to - 13)::timestamp) AT TIME ZONE p_tz);

  SELECT (value #>> '{}')::numeric INTO v_goal_daily FROM settings WHERE market_id = v_market AND key = 'goal_daily_treated';
  SELECT (value #>> '{}')::numeric INTO v_goal_rate  FROM settings WHERE market_id = v_market AND key = 'goal_min_rate';
  SELECT (value #>> '{}')::numeric INTO v_goal_cph   FROM settings WHERE market_id = v_market AND key = 'goal_conf_per_hour';
  SELECT (value #>> '{}')::numeric INTO v_goal_team  FROM settings WHERE market_id = v_market AND key = 'goal_team_weekly_conf';
  v_goal_daily := COALESCE(v_goal_daily, 12);
  v_goal_rate  := COALESCE(v_goal_rate, 40);
  v_goal_cph   := COALESCE(v_goal_cph, 3);
  v_goal_team  := COALESCE(v_goal_team, 150);

  WITH
  agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.last_seen_at
    FROM users u
    WHERE u.role = 'agent' AND u.is_active AND u.deleted_at IS NULL AND u.market_id = v_market
  ),
  hist AS (
    SELECT h.actor_id AS agent_id, h.order_id, h.status_to, h.created_at,
      (h.created_at AT TIME ZONE p_tz)::date AS d,
      (h.created_at >= v_from AND h.created_at < v_to) AS in_period,
      COALESCE(o.product_id::text, o.product_name, '(inconnu)') AS product_key,
      COALESCE(p.name, o.product_name, '(inconnu)') AS product_name,
      p.image_url,
      o.rejection_reason::text AS rejection_reason
    FROM order_history h
    JOIN orders o ON o.id = h.order_id
    LEFT JOIN products p ON p.id = o.product_id
    WHERE h.market_id = v_market
      AND h.created_at >= v_hist_from AND h.created_at < v_to
      AND h.actor_id IN (SELECT id FROM agents)
  ),
  per_agent AS (
    SELECT agent_id,
      count(DISTINCT order_id) FILTER (WHERE in_period AND status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE in_period AND status_to = 'confirmed') AS confirmed,
      count(DISTINCT order_id) FILTER (WHERE in_period AND status_to = 'rejected') AS rejected,
      count(*) FILTER (WHERE in_period AND status_to IN ('attempt_1','attempt_2','attempt_3','confirmed','rejected','callback_scheduled')) AS touches,
      count(DISTINCT floor(extract(epoch FROM created_at) / 600)) FILTER (WHERE in_period) * 10 AS active_minutes,
      count(DISTINCT d) FILTER (WHERE in_period) AS days_active
    FROM hist GROUP BY agent_id
  ),
  daily AS (
    SELECT agent_id, d,
      count(DISTINCT floor(extract(epoch FROM created_at) / 600)) * 10 AS active_minutes,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist GROUP BY agent_id, d
  ),
  agent_products AS (
    SELECT agent_id, product_key, max(product_name) AS product_name, max(image_url) AS image_url,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist WHERE in_period AND status_to IN ('confirmed','rejected')
    GROUP BY agent_id, product_key
  ),
  motifs AS (
    SELECT agent_id, COALESCE(rejection_reason, 'unknown') AS reason, count(DISTINCT order_id) AS n
    FROM hist WHERE in_period AND status_to = 'rejected'
    GROUP BY agent_id, reason
  ),
  tg AS (
    SELECT DISTINCT ON (t.agent_id, t.metric) t.agent_id, t.metric, t.value
    FROM agent_targets t WHERE t.market_id = v_market
    ORDER BY t.agent_id, t.metric, t.created_at DESC
  ),
  team_products AS (
    SELECT product_key, max(product_name) AS product_name, max(image_url) AS image_url,
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist WHERE in_period AND status_to IN ('confirmed','rejected')
    GROUP BY product_key
  ),
  team AS (
    SELECT
      count(DISTINCT order_id) FILTER (WHERE status_to IN ('confirmed','rejected')) AS treated,
      count(DISTINCT order_id) FILTER (WHERE status_to = 'confirmed') AS confirmed
    FROM hist WHERE in_period
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'tz', p_tz, 'market_id', v_market,
    'defaults', jsonb_build_object(
      'daily_treated', v_goal_daily, 'min_rate', v_goal_rate,
      'conf_per_hour', v_goal_cph, 'team_weekly_conf', v_goal_team),
    'team', jsonb_build_object(
      'treated', (SELECT treated FROM team),
      'confirmed', (SELECT confirmed FROM team),
      'active_minutes', (SELECT COALESCE(sum(active_minutes), 0) FROM per_agent),
      'agents_active', (SELECT count(*) FROM per_agent WHERE treated > 0 OR active_minutes > 0),
      'agents_total', (SELECT count(*) FROM agents)),
    'agents', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'name', a.full_name, 'avatar_url', a.avatar_url, 'last_seen_at', a.last_seen_at,
        'treated', COALESCE(pa.treated, 0), 'confirmed', COALESCE(pa.confirmed, 0), 'rejected', COALESCE(pa.rejected, 0),
        'touches', COALESCE(pa.touches, 0), 'active_minutes', COALESCE(pa.active_minutes, 0), 'days_active', COALESCE(pa.days_active, 0),
        'daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'day', d, 'active_minutes', active_minutes, 'treated', treated, 'confirmed', confirmed) ORDER BY d), '[]'::jsonb)
          FROM daily WHERE daily.agent_id = a.id),
        'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'key', product_key, 'name', product_name, 'image_url', image_url, 'treated', treated, 'confirmed', confirmed) ORDER BY treated DESC), '[]'::jsonb)
          FROM agent_products ap WHERE ap.agent_id = a.id),
        'motifs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) ORDER BY n DESC), '[]'::jsonb)
          FROM motifs m WHERE m.agent_id = a.id),
        'targets', jsonb_build_object(
          'daily_treated', (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'daily_treated'),
          'min_rate',      (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'min_rate'),
          'conf_per_hour', (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'conf_per_hour'),
          'throughput',    (SELECT value FROM tg WHERE tg.agent_id = a.id AND tg.metric = 'throughput'))
      ) ORDER BY COALESCE(pa.confirmed, 0) DESC, a.full_name), '[]'::jsonb)
      FROM agents a LEFT JOIN per_agent pa ON pa.agent_id = a.id
    ),
    'products', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', tp.product_key, 'name', tp.product_name, 'image_url', tp.image_url,
        'treated', tp.treated, 'confirmed', tp.confirmed,
        'agents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'agent_id', ap.agent_id, 'treated', ap.treated, 'confirmed', ap.confirmed) ORDER BY ap.treated DESC), '[]'::jsonb)
          FROM agent_products ap WHERE ap.product_key = tp.product_key)
      ) ORDER BY tp.treated DESC), '[]'::jsonb)
      FROM team_products tp
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION get_team_performance(UUID, DATE, DATE, TEXT) IS
  'Performance équipe rollup for a local-day period: per-agent treated/confirmed/active minutes/daily series (14 d for streaks)/products/motifs/targets, team totals, per-product agent spread. One round-trip; SECURITY DEFINER; market isolation in-function. Ranking, goals and streaks are judged in lib/team/goals.ts.';

GRANT EXECUTE ON FUNCTION get_team_performance(UUID, DATE, DATE, TEXT) TO authenticated;
