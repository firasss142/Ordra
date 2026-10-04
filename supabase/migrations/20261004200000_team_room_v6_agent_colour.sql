-- Salle de contrôle v6 (prototypes/team-v6.html) — each agent has her own colour,
-- on every surface: her card, her ring, her avatar, her table row, her drawer.
-- Owner's answer 2026-10-04: SAVED per agent, so a colour never moves when someone
-- joins or leaves. Six hues, validated with dataviz validate_palette.js against each
-- other (the Performance palette): indigo #444CE7 · pink #DD2590 · cyan #088AB2 ·
-- gold #CA8504 · lime #4CA30D · orange #E04F16. The hex lives in the CSS
-- (--agent-<key>-*); the database stores the key.
--
-- 1. users.color + a trigger: an agent without one gets the first hue nobody in her
--    market wears (the least-worn once all six are taken).
-- 2. Backfill: Libya as the prototype drew it; everyone else, first free by age.
-- 3. get_team_day and get_team_funnel return it. Their bodies are 20261003200000's,
--    unchanged but for one 'color' field; CREATE OR REPLACE keeps the grants.
--
-- users is column-granted for UPDATE (users-rls-column-blind-escalation): a new column
-- is not in that list, so nobody can PATCH their own colour through PostgREST.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The column and who picks it
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_color_check;
ALTER TABLE public.users ADD CONSTRAINT users_color_check
  CHECK (color IS NULL OR color IN ('indigo','pink','cyan','gold','lime','orange'));

COMMENT ON COLUMN public.users.color IS
  'An agent''s own colour on the team surfaces (Salle de contrôle v6). Key into --agent-<key>-* in globals.css. Set by trg_users_agent_color.';

CREATE OR REPLACE FUNCTION public.agent_color_pick(p_market_id uuid, p_exclude uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT k.key
  FROM unnest(ARRAY['indigo','pink','cyan','gold','lime','orange']) WITH ORDINALITY AS k(key, ord)
  LEFT JOIN users u
    ON u.color = k.key AND u.market_id = p_market_id AND u.role = 'agent'
   AND u.deleted_at IS NULL AND u.id IS DISTINCT FROM p_exclude
  GROUP BY k.key, k.ord
  ORDER BY count(u.id), k.ord
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.agent_color_pick(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.users_agent_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER -- agent_color_pick is revoked from every client role, and must see every agent
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'agent' AND NEW.market_id IS NOT NULL
     AND (NEW.color IS NULL OR (TG_OP = 'UPDATE' AND NEW.market_id IS DISTINCT FROM OLD.market_id)) THEN
    NEW.color := agent_color_pick(NEW.market_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.users_agent_color() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_agent_color ON public.users;
CREATE TRIGGER trg_users_agent_color
  BEFORE INSERT OR UPDATE OF role, market_id, color ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_agent_color();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill — Libya as the prototype drew it, then first free by age
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.users u SET color = v.color
FROM (VALUES ('tasnim','indigo'), ('salima','pink'), ('roqaya','cyan'),
             ('hend','gold'), ('mouna','lime'), ('riheb','orange')) AS v(name, color)
WHERE u.role = 'agent' AND u.deleted_at IS NULL AND u.color IS NULL
  AND u.market_id = '00000000-0000-0000-0000-000000000002'
  AND lower(u.full_name) = v.name;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, market_id FROM users
           WHERE role = 'agent' AND deleted_at IS NULL AND color IS NULL AND market_id IS NOT NULL
           ORDER BY market_id, created_at, id
  LOOP
    UPDATE users SET color = agent_color_pick(r.market_id, r.id) WHERE id = r.id;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_team_day — 20261003200000 + color
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_day(p_market_id uuid, p_day date, p_tz text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := get_user_role();
  v_market uuid;
  v_now    timestamptz := now();
  v_today  date;
  v_day    date;
  v_start  timestamptz;
  v_end    timestamptz;
  v_cut    timestamptz;
  v_live   boolean;
  v_week   timestamptz;
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
  IF v_market IS NULL OR p_day IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_today := (v_now AT TIME ZONE p_tz)::date;
  v_day   := LEAST(p_day, v_today);
  v_start := v_day::timestamp AT TIME ZONE p_tz;
  v_end   := (v_day + 1)::timestamp AT TIME ZONE p_tz;
  v_live  := v_day = v_today;
  v_cut   := LEAST(v_end, v_now);
  v_week  := (v_today - 6)::timestamp AT TIME ZONE p_tz;

  WITH agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.color, u.phone, u.last_seen_at, u.is_available
    FROM users u
    WHERE u.role = 'agent' AND u.market_id = v_market AND u.deleted_at IS NULL AND u.is_active
  ),
  -- The day's actions. Uploads are activity too: an agent clearing her confirmed
  -- orders is working even when she places no call.
  hist AS (
    SELECT h.actor_id, h.order_id, h.status_to::text AS st, h.created_at
    FROM order_history h
    JOIN agents a ON a.id = h.actor_id
    WHERE h.created_at >= v_start AND h.created_at < v_cut
      AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')
  ),
  ev AS (
    SELECT hist.actor_id AS agent_id,
      jsonb_agg(jsonb_build_array(
        floor(extract(epoch FROM hist.created_at - v_start) / 60)::int,
        CASE hist.st
          WHEN 'callback_scheduled' THEN 'b'
          WHEN 'confirmed' THEN 'c'
          WHEN 'rejected' THEN 'r'
          WHEN 'uploaded' THEN 'u'
          ELSE 'a'
        END) ORDER BY hist.created_at) AS events,
      count(DISTINCT hist.order_id) FILTER (WHERE hist.st = 'uploaded') AS up,
      count(DISTINCT hist.order_id) FILTER (WHERE hist.st = 'rejected') AS rej,
      count(*) FILTER (WHERE hist.st IN ('attempt_1','attempt_2','attempt_3','callback_scheduled')) AS att
    FROM hist
    GROUP BY hist.actor_id
  ),
  -- Orders handed to each agent that day, with the delay to her first call (any time
  -- since, so a past day still knows who was called late). x = 1 when the order has
  -- since been cancelled: it needed no call.
  asg AS (
    SELECT o.assigned_to AS agent_id, o.id, o.assigned_at, (o.status = 'cancelled') AS cancelled
    FROM orders o
    JOIN agents a ON a.id = o.assigned_to
    WHERE o.market_id = v_market AND o.assigned_at >= v_start AND o.assigned_at < v_cut
      AND o.status <> 'deleted'
  ),
  asg_agg AS (
    SELECT s.agent_id,
      jsonb_agg(jsonb_build_array(
        floor(extract(epoch FROM s.assigned_at - v_start) / 60)::int,
        (SELECT floor(extract(epoch FROM min(h.created_at) - s.assigned_at) / 60)::int
           FROM order_history h
          WHERE h.order_id = s.id AND h.actor_id = s.agent_id AND h.created_at >= s.assigned_at
            AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected')),
        CASE WHEN s.cancelled THEN 1 ELSE 0 END) ORDER BY s.assigned_at) AS assigned
    FROM asg s
    GROUP BY s.agent_id
  ),
  -- What each agent holds right now (today only): p = never touched, a = attempted,
  -- cb = callback, cf = confirmed and waiting for its upload.
  q AS (
    SELECT o.assigned_to AS agent_id,
      CASE
        WHEN o.status IN ('pending','new','assigned') THEN 'p'
        WHEN o.status = 'callback_scheduled' THEN 'cb'
        WHEN o.status = 'confirmed' THEN 'cf'
        ELSE 'a'
      END AS code,
      floor(extract(epoch FROM v_now - COALESCE(o.assigned_at, o.created_at)) / 60)::int AS held_min,
      EXISTS (
        SELECT 1 FROM order_history h
        WHERE h.order_id = o.id AND h.actor_id = o.assigned_to
          AND h.created_at >= COALESCE(o.assigned_at, o.created_at)
          AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected')
      ) AS called
    FROM orders o
    JOIN agents a ON a.id = o.assigned_to
    WHERE v_live AND o.market_id = v_market
      AND o.status IN ('pending','new','assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed')
  ),
  q_agg AS (
    SELECT q.agent_id,
      jsonb_agg(jsonb_build_array(q.code, q.held_min, CASE WHEN q.called THEN 1 ELSE 0 END) ORDER BY q.held_min DESC) AS queue
    FROM q
    GROUP BY q.agent_id
  ),
  last_act AS (
    SELECT a.id AS agent_id,
      (SELECT max(h.created_at) FROM order_history h
        WHERE h.actor_id = a.id
          AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')) AS at
    FROM agents a
  ),
  recv AS (
    SELECT count(*) AS n, max(o.created_at) AS last_at
    FROM orders o
    WHERE o.market_id = v_market AND o.created_at >= v_start AND o.created_at < v_cut
  ),
  dlv AS (
    SELECT count(DISTINCT h.order_id) AS n
    FROM order_history h
    WHERE h.market_id = v_market AND h.status_to = 'delivered'
      AND h.created_at >= v_start AND h.created_at < v_cut
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'day', v_day,
    'today', v_today,
    'tz', p_tz,
    'live', v_live,
    'now_min', CASE WHEN v_live THEN floor(extract(epoch FROM v_now - v_start) / 60)::int END,
    'computed_at', v_now,
    'last_order_at', (SELECT max(o.created_at) FROM orders o WHERE o.market_id = v_market),
    'settings', jsonb_build_object(
      'call_delay_hours', delivery_setting_int(v_market, 'team_call_delay_hours', 2),
      'idle_minutes',     delivery_setting_int(v_market, 'team_idle_minutes', 30),
      'late_minutes',     delivery_setting_int(v_market, 'team_late_minutes', 15),
      'shift',            (SELECT s.value FROM settings s WHERE s.market_id = v_market AND s.key = 'shift_config'),
      'overrides',        (SELECT s.value FROM settings s WHERE s.market_id = v_market AND s.key = 'team_shift_overrides')
    ),
    'team', jsonb_build_object(
      'received', (SELECT n FROM recv),
      'received_last_at', (SELECT last_at FROM recv),
      'delivered', (SELECT n FROM dlv)
    ),
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.id,
        'name', a.full_name,
        'avatar_url', a.avatar_url,
        'color', a.color,
        'phone', a.phone,
        'last_seen_at', a.last_seen_at,
        'is_available', COALESCE(a.is_available, false),
        'last_action_at', la.at,
        'active_7d', COALESCE(la.at >= v_week, false),
        'events', COALESCE(ev.events, '[]'::jsonb),
        'up', COALESCE(ev.up, 0),
        'rej', COALESCE(ev.rej, 0),
        'att', COALESCE(ev.att, 0),
        'assigned', COALESCE(sa.assigned, '[]'::jsonb),
        'queue', COALESCE(qa.queue, '[]'::jsonb)
      ) ORDER BY a.full_name)
      FROM agents a
      LEFT JOIN ev ON ev.agent_id = a.id
      LEFT JOIN asg_agg sa ON sa.agent_id = a.id
      LEFT JOIN q_agg qa ON qa.agent_id = a.id
      LEFT JOIN last_act la ON la.agent_id = a.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_team_funnel — 20261003200000 + color
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_funnel(p_market_id uuid, p_from date, p_to date, p_tz text,
                                                  p_prev_from date DEFAULT NULL, p_prev_to date DEFAULT NULL)
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
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RETURN '{}'::jsonb; END IF;

  v_len    := p_to - p_from + 1;
  IF p_prev_from IS NOT NULL AND p_prev_to IS NOT NULL AND p_prev_from <= p_prev_to AND p_prev_to < p_from THEN
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
    SELECT u.id, u.full_name, u.avatar_url, u.color, u.is_active
    FROM users u
    WHERE u.role = 'agent' AND u.market_id = v_market AND u.deleted_at IS NULL
  ),
  coh AS (
    SELECT o.assigned_to AS agent_id, o.status::text AS st, (o.assigned_at >= v_start) AS cur,
      CASE WHEN o.assigned_at >= v_start THEN
        commission_order_stage(o.status) IN ('awaiting_scan','with_carrier','out','delayed','returning','delivered','returned')
        OR EXISTS (SELECT 1 FROM order_history h WHERE h.order_id = o.id AND h.status_to = 'uploaded')
      ELSE false END AS upl
    FROM orders o
    JOIN agents a ON a.id = o.assigned_to
    WHERE o.market_id = v_market
      AND ((o.assigned_at >= v_start AND o.assigned_at < v_end) OR (o.assigned_at >= v_pstart AND o.assigned_at < v_pend))
      AND o.status <> 'deleted'
  ),
  per AS (
    SELECT c.agent_id,
      count(*) FILTER (WHERE c.cur) AS assigned,
      count(*) FILTER (WHERE c.cur AND c.upl) AS uploaded,
      count(*) FILTER (WHERE c.cur AND c.st = 'delivered') AS delivered,
      count(*) FILTER (WHERE c.cur AND c.upl AND c.st IN ('uploaded','dispatching','scanned','at_carrier','dispatched','deposit','in_transit','unverified','out_for_delivery','delivery_delayed')) AS en_route,
      count(*) FILTER (WHERE c.cur AND c.upl AND c.st IN ('cancelled','returning','to_be_returned','returned','received')) AS returned,
      count(*) FILTER (WHERE c.cur AND c.st IN ('pending','new','assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','dispatch_scheduled')) AS open,
      count(*) FILTER (WHERE NOT c.cur) AS prev_assigned,
      count(*) FILTER (WHERE NOT c.cur AND c.st = 'delivered') AS prev_delivered
    FROM coh c
    GROUP BY c.agent_id
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from, 'to', p_to,
    'prev_from', v_pfrom, 'prev_to', v_pto,
    'tz', p_tz,
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'name', a.full_name, 'avatar_url', a.avatar_url, 'color', a.color, 'is_active', a.is_active,
        'last_action_at', (SELECT max(h.created_at) FROM order_history h
                            WHERE h.actor_id = a.id
                              AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')),
        'assigned', COALESCE(p.assigned, 0), 'uploaded', COALESCE(p.uploaded, 0),
        'delivered', COALESCE(p.delivered, 0), 'en_route', COALESCE(p.en_route, 0),
        'returned', COALESCE(p.returned, 0), 'open', COALESCE(p.open, 0),
        'prev_assigned', COALESCE(p.prev_assigned, 0), 'prev_delivered', COALESCE(p.prev_delivered, 0)
      ) ORDER BY a.full_name)
      FROM agents a
      LEFT JOIN per p ON p.agent_id = a.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
