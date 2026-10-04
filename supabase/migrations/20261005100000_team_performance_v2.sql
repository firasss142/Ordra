-- Performance › Équipe — the one read behind /team/performance
-- (plans/team-performance-redesign.md, prototypes/team-performance-v3.html).
--
-- WHAT IT RETURNS: facts, not figures. The page's rules (outcomes per 100, the
-- ranking, the leaks and their thresholds, débit × taux, the shift segments,
-- the product tiles) are computed in TypeScript (src/lib/team/performance),
-- where every rule has a test.
--
--   · orders     — every order ASSIGNED in the window (or the window before) to an
--                  agent of the market who still holds it (Salle de contrôle v5's
--                  cohort, deleted orders included: they count as « jamais réelles »);
--                  with: was it uploaded, was it ever tried before a rejection,
--                  was its first call more than 24 h after the assignment.
--   · decisions  — distinct orders she uploaded / rejected in each window (v5).
--   · actions    — the local minutes of her actions, per local day (v5's action
--                  set: attempts, callback, confirmed, rejected, uploaded). The
--                  shift segments are chained from these in TypeScript.
--   · products, reasons — the names the page prints.
--
-- Read-only, SECURITY DEFINER, the market guard of get_team_funnel: super_admin
-- names the market, a market_manager is pinned to their own, everyone else '{}'.
-- Replaces get_team_performance (drop it once this is deployed and nothing calls it).

CREATE OR REPLACE FUNCTION public.get_team_performance_v2(
  p_market_id uuid, p_from date, p_to date, p_tz text,
  p_prev_from date DEFAULT NULL, p_prev_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := get_user_role();
  v_market uuid;
  v_len    int;
  v_pfrom  date;
  v_pto    date;
  v_start  timestamptz;
  v_end    timestamptz;
  v_pstart timestamptz;
  v_pend   timestamptz;
  v_result jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_tz IS NULL
     OR p_to - p_from > 400 THEN
    RETURN '{}'::jsonb;
  END IF;

  v_len := p_to - p_from + 1;
  IF p_prev_from IS NOT NULL AND p_prev_to IS NOT NULL AND p_prev_from <= p_prev_to AND p_prev_to < p_from
     AND p_prev_to - p_prev_from <= 400 THEN
    v_pfrom := p_prev_from;
    v_pto   := p_prev_to;
  ELSE
    v_pfrom := p_from - v_len;
    v_pto   := p_from - 1;
  END IF;
  v_start  := p_from::timestamp AT TIME ZONE p_tz;
  v_end    := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_pstart := v_pfrom::timestamp AT TIME ZONE p_tz;
  v_pend   := (v_pto + 1)::timestamp AT TIME ZONE p_tz;

  WITH agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.color
    FROM users u
    WHERE u.role = 'agent' AND u.market_id = v_market AND u.deleted_at IS NULL
  ),
  coh AS (
    SELECT o.id, o.assigned_to AS agent_id, (o.assigned_at >= v_start) AS cur, o.assigned_at,
           o.status::text AS st, o.rejection_reason::text AS rsn, o.rejection_subreason AS sub, o.product_id,
           (commission_order_stage(o.status) IN ('awaiting_scan','with_carrier','out','delayed','returning','delivered','returned')
             OR EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id AND h.status_to = 'uploaded')) AS upl
    FROM orders o
    JOIN agents a ON a.id = o.assigned_to
    WHERE o.market_id = v_market
      AND ((o.assigned_at >= v_start AND o.assigned_at < v_end) OR (o.assigned_at >= v_pstart AND o.assigned_at < v_pend))
  ),
  -- The first call on each order of the window, after its assignment.
  first_call AS (
    SELECT h.order_id, min(h.created_at) AS at
    FROM order_history h
    JOIN coh c ON c.id = h.order_id AND c.cur
    WHERE h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')
      AND h.created_at >= c.assigned_at
    GROUP BY h.order_id
  ),
  dec AS (
    SELECT h.actor_id AS agent_id, (h.created_at >= v_start) AS cur,
           count(DISTINCT h.order_id) FILTER (WHERE h.status_to = 'uploaded') AS up,
           count(DISTINCT h.order_id) FILTER (WHERE h.status_to = 'rejected') AS rej
    FROM order_history h
    JOIN agents a ON a.id = h.actor_id
    WHERE h.market_id = v_market
      AND h.status_to IN ('uploaded','rejected')
      AND ((h.created_at >= v_start AND h.created_at < v_end) OR (h.created_at >= v_pstart AND h.created_at < v_pend))
    GROUP BY 1, 2
  ),
  act AS (
    SELECT h.actor_id AS agent_id, (h.created_at AT TIME ZONE p_tz) AS lt
    FROM order_history h
    JOIN agents a ON a.id = h.actor_id
    WHERE h.market_id = v_market
      AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')
      AND ((h.created_at >= v_start AND h.created_at < v_end) OR (h.created_at >= v_pstart AND h.created_at < v_pend))
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from, 'to', p_to,
    'prev_from', v_pfrom, 'prev_to', v_pto,
    'tz', p_tz,
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name, 'color', a.color, 'avatar_url', a.avatar_url)
                       ORDER BY a.full_name)
      FROM agents a
    ), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'a', c.agent_id,
        'cur', c.cur,
        'st', c.st,
        'upl', c.upl,
        'rsn', c.rsn,
        'sub', c.sub,
        'p', c.product_id,
        -- rejected without one attempt or callback before
        'no_try', CASE WHEN c.cur AND c.st = 'rejected' THEN NOT EXISTS (
            SELECT 1 FROM order_history h WHERE h.order_id = c.id
              AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled')) END,
        'late', CASE WHEN c.cur THEN fc.at > c.assigned_at + interval '24 hours' END
      ))
      FROM coh c
      LEFT JOIN first_call fc ON fc.order_id = c.id
    ), '[]'::jsonb),
    'decisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('a', d.agent_id, 'cur', d.cur, 'up', d.up, 'rej', d.rej)) FROM dec d
    ), '[]'::jsonb),
    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('a', x.agent_id, 'day', x.day, 'mins', x.mins))
      FROM (
        SELECT agent_id, lt::date AS day,
               array_agg((extract(hour FROM lt) * 60 + extract(minute FROM lt))::int ORDER BY lt) AS mins
        FROM act
        GROUP BY agent_id, lt::date
      ) x
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'image_url', p.image_url))
      FROM products p
      WHERE p.id IN (SELECT DISTINCT c.product_id FROM coh c WHERE c.product_id IS NOT NULL)
    ), '[]'::jsonb),
    'reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', r.key, 'group', r.parent_key, 'fr', r.label_fr, 'ar', r.label_ar))
      FROM rejection_reason_configs r
      WHERE r.market_id = v_market AND r.parent_key IS NOT NULL
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_performance_v2(uuid, date, date, text, date, date) IS
  'Performance › Équipe: the facts of [from, to] and the window before (market-local days) — orders assigned per agent with their outcome flags, decisions, action minutes per local day, product and reason names. Rules live in src/lib/team/performance.';

-- SECURITY DEFINER functions are executable by PUBLIC by default: revoke first.
REVOKE EXECUTE ON FUNCTION public.get_team_performance_v2(uuid, date, date, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_performance_v2(uuid, date, date, text, date, date) TO authenticated;
