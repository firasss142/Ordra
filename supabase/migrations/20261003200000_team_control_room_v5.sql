-- Salle de contrôle v5 — the four reads behind /team (plans/team-control-room-v5.md,
-- prototypes/team-v5.html). Read-only, SECURITY DEFINER, same market guard as
-- get_team_commissions: super_admin names the market, a market_manager is pinned to
-- their own, everyone else gets '{}'.
--
-- Definitions shared by all four (they are the prototype's own queries):
--   call statuses  = attempt_1/2/3, callback_scheduled, confirmed, rejected
--   « non appelée » = in the holder's queue with no call-status row BY THE HOLDER since
--                     assigned_at — a reassigned order counts for its new holder
--   funnel cohort  = orders assigned to the agent in the period, status <> deleted
--
-- Thresholds (call delay, idle minutes, tolerated lateness) are settings; the day and
-- alerts reads return or apply the values in force so the page and the bell agree.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_team_day — one market-local day: who worked, what moved, what is still held.
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
    SELECT u.id, u.full_name, u.avatar_url, u.phone, u.last_seen_at, u.is_available
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

COMMENT ON FUNCTION public.get_team_day(uuid, date, text) IS
  'Salle de contrôle: one market-local day per agent — actions (events), assignments with first-call delay, the live queue (today only), presence, and the control-room settings in force.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_team_funnel — assigned → uploaded → delivered for a period, and a previous
--    period for the trend arrow: the one given (a month compares with the month
--    before), else the same number of days just before.
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
    SELECT u.id, u.full_name, u.avatar_url, u.is_active
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
        'agent_id', a.id, 'name', a.full_name, 'avatar_url', a.avatar_url, 'is_active', a.is_active,
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

COMMENT ON FUNCTION public.get_team_funnel(uuid, date, date, text, date, date) IS
  'Salle de contrôle: per agent, orders assigned in [from, to] → uploaded → delivered / en route / returned, plus assigned and delivered for the previous period (given, else the same length just before).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_team_agent_panel — one agent over a short period: products, rejection groups,
--    her last 30 days of uploads, and her commission.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_agent_panel(p_market_id uuid, p_agent_id uuid, p_from date, p_to date, p_tz text)
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
  v_start  timestamptz;
  v_end    timestamptz;
  v_30     timestamptz;
  v_rate   record;
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
  IF v_market IS NULL OR p_agent_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RETURN '{}'::jsonb; END IF;
  -- The agent must belong to the market the caller may read.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_agent_id AND u.role = 'agent' AND u.market_id = v_market) THEN
    RETURN '{}'::jsonb;
  END IF;

  v_today := (v_now AT TIME ZONE p_tz)::date;
  v_start := p_from::timestamp AT TIME ZONE p_tz;
  v_end   := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_30    := (v_today - 29)::timestamp AT TIME ZONE p_tz;

  SELECT r.enabled, r.amount, r.effective_from INTO v_rate
  FROM resolve_commission_rate(v_market, p_agent_id, v_today) r;

  WITH h AS (
    SELECT h.order_id, h.status_to::text AS st, count(*) AS n
    FROM order_history h
    WHERE h.actor_id = p_agent_id AND h.created_at >= v_start AND h.created_at < v_end
      AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','rejected','uploaded')
    GROUP BY h.order_id, h.status_to
  ),
  pr AS (
    SELECT o.product_id, 1 AS asg, 0 AS up, 0 AS rej, 0 AS att
    FROM orders o
    WHERE o.assigned_to = p_agent_id AND o.market_id = v_market
      AND o.assigned_at >= v_start AND o.assigned_at < v_end AND o.status <> 'deleted'
    UNION ALL
    SELECT o.product_id, 0,
      CASE WHEN h.st = 'uploaded' THEN 1 ELSE 0 END,
      CASE WHEN h.st = 'rejected' THEN 1 ELSE 0 END,
      CASE WHEN h.st IN ('attempt_1','attempt_2','attempt_3','callback_scheduled') THEN h.n ELSE 0 END
    FROM h JOIN orders o ON o.id = h.order_id
  ),
  prod AS (
    SELECT pr.product_id, sum(pr.asg) AS assigned, sum(pr.up) AS uploaded, sum(pr.rej) AS rejected, sum(pr.att) AS attempts
    FROM pr
    GROUP BY pr.product_id
  ),
  rej AS (
    SELECT COALESCE(o.rejection_reason::text, 'autre') AS grp, count(DISTINCT h.order_id) AS n
    FROM h JOIN orders o ON o.id = h.order_id
    WHERE h.st = 'rejected'
    GROUP BY 1
  ),
  -- Her uploads among the orders assigned to her over the last 30 days.
  d30 AS (
    SELECT o.status::text AS st
    FROM orders o
    WHERE o.assigned_to = p_agent_id AND o.market_id = v_market
      AND o.assigned_at >= v_30 AND o.status <> 'deleted'
      AND (commission_order_stage(o.status) IN ('awaiting_scan','with_carrier','out','delayed','returning','delivered','returned')
           OR EXISTS (SELECT 1 FROM order_history x WHERE x.order_id = o.id AND x.status_to = 'uploaded'))
  ),
  fold AS (
    SELECT
      COALESCE(sum(l.amount), 0) AS balance,
      COALESCE(sum(l.amount) FILTER (WHERE l.entry_type = 'accrual' OR (l.entry_type = 'adjustment' AND l.amount > 0)), 0) AS earned,
      count(*) FILTER (WHERE l.entry_type = 'accrual') AS earned_n,
      COALESCE(-sum(l.amount) FILTER (WHERE l.entry_type = 'reversal' OR (l.entry_type = 'adjustment' AND l.amount < 0)), 0) AS back,
      count(*) FILTER (WHERE l.entry_type = 'reversal') AS back_n,
      COALESCE(-sum(l.amount) FILTER (WHERE l.entry_type = 'payout'), 0) AS paid,
      count(*) FILTER (WHERE l.entry_type = 'payout') AS paid_n,
      count(*) AS entries
    FROM agent_commission_ledger l
    WHERE l.agent_id = p_agent_id AND l.market_id = v_market
  ),
  days AS (
    SELECT d::date AS day,
      COALESCE(sum(l.amount) FILTER (WHERE l.entry_type <> 'payout'), 0) AS net,
      COALESCE(-sum(l.amount) FILTER (WHERE l.entry_type = 'payout'), 0) AS paid
    FROM generate_series(v_today - 13, v_today, interval '1 day') d
    LEFT JOIN agent_commission_ledger l
      ON l.agent_id = p_agent_id AND l.market_id = v_market
     AND (l.effective_at AT TIME ZONE p_tz)::date = d::date
    GROUP BY d
  ),
  -- Parcels she confirmed that are still on their way, uploaded within 21 days (older
  -- `uploaded` rows are stale, not in flight) — what she may still earn.
  inflight AS (
    SELECT o.status
    FROM orders o
    CROSS JOIN LATERAL (
      SELECT x.actor_id AS agent_id
      FROM order_history x JOIN users u ON u.id = x.actor_id AND u.role = 'agent'
      WHERE x.order_id = o.id AND x.status_to = 'confirmed'
      ORDER BY x.created_at DESC LIMIT 1
    ) lc
    WHERE o.market_id = v_market
      AND lc.agent_id = p_agent_id
      AND o.status IN ('uploaded','dispatching','scanned','at_carrier','dispatched','deposit','in_transit','unverified','out_for_delivery','delivery_delayed')
      AND EXISTS (SELECT 1 FROM order_history x WHERE x.order_id = o.id AND x.status_to = 'uploaded' AND x.created_at >= v_now - interval '21 days')
      AND commission_counts_upload(o.id, p_agent_id, v_now)
  ),
  last_pay AS (
    SELECT l.effective_at, -l.amount AS amount
    FROM agent_commission_ledger l
    WHERE l.agent_id = p_agent_id AND l.market_id = v_market AND l.entry_type = 'payout'
    ORDER BY l.effective_at DESC, l.created_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'agent_id', p_agent_id,
    'from', p_from, 'to', p_to, 'today', v_today, 'tz', p_tz,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.product_id, 'name', pp.name, 'image_url', pp.image_url,
        'assigned', p.assigned, 'uploaded', p.uploaded, 'rejected', p.rejected, 'attempts', p.attempts
      ) ORDER BY (p.assigned + p.uploaded + p.rejected) DESC, pp.name)
      FROM prod p
      LEFT JOIN products pp ON pp.id = p.product_id
    ), '[]'::jsonb),
    'rejections', COALESCE((SELECT jsonb_agg(jsonb_build_object('group', r.grp, 'n', r.n) ORDER BY r.n DESC, r.grp) FROM rej r), '[]'::jsonb),
    'delivered_30', (SELECT jsonb_build_object(
        'delivered', count(*) FILTER (WHERE d30.st = 'delivered'),
        'returned',  count(*) FILTER (WHERE d30.st IN ('cancelled','returning','to_be_returned','returned','received')),
        'en_route',  count(*) FILTER (WHERE d30.st IN ('uploaded','dispatching','scanned','at_carrier','dispatched','deposit','in_transit','unverified','out_for_delivery','delivery_delayed')))
      FROM d30),
    'commission', (SELECT jsonb_build_object(
        'currency', (SELECT m.currency FROM markets m WHERE m.id = v_market),
        'enabled', COALESCE(v_rate.enabled, false),
        'rate', COALESCE(v_rate.amount, 0),
        'rate_since', v_rate.effective_from,
        'balance', f.balance, 'earned', f.earned, 'earned_n', f.earned_n,
        'back', f.back, 'back_n', f.back_n, 'paid', f.paid, 'paid_n', f.paid_n,
        'entries', f.entries,
        'days', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'net', d.net, 'paid', d.paid) ORDER BY d.day) FROM days d),
        'sum_14', (SELECT COALESCE(sum(d.net), 0) FROM days d),
        'in_flight', (SELECT count(*) FROM inflight),
        'in_flight_late', (SELECT count(*) FROM inflight WHERE status = 'delivery_delayed'),
        -- At most this much more, if every one of them is delivered at today's rate.
        'coming', CASE WHEN COALESCE(v_rate.enabled, false) THEN (SELECT count(*) FROM inflight) * COALESCE(v_rate.amount, 0) ELSE 0 END,
        'last_payout', (SELECT jsonb_build_object('at', lp.effective_at, 'amount', lp.amount) FROM last_pay lp))
      FROM fold f)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_agent_panel(uuid, uuid, date, date, text) IS
  'Salle de contrôle agent panel: per product (assigned, uploaded, rejected, attempts), rejection groups, her uploads of the last 30 days, and her commission (balance = earned − taken back − paid, 14 days, in flight, last payout).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_team_alerts — the bell: orders stopped arriving, orders not called N h after
--    assignment, an agent online but not calling. NULL market = every market (super_admin).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_alerts(p_market_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := get_user_role();
  v_market uuid;
  v_all    boolean := false;
  v_now    timestamptz := now();
  v_result jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
    v_all := p_market_id IS NULL;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
    IF v_market IS NULL THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;

  WITH mk AS (
    SELECT m.id, market_tz(m.id) AS tz,
      delivery_setting_int(m.id, 'team_call_delay_hours', 2) AS call_h,
      delivery_setting_int(m.id, 'team_idle_minutes', 30) AS idle_min
    FROM markets m
    WHERE m.is_active AND (v_all OR m.id = v_market)
  ),
  agents AS (
    SELECT u.id, u.full_name, u.market_id, u.last_seen_at, mk.tz, mk.call_h, mk.idle_min
    FROM users u JOIN mk ON mk.id = u.market_id
    WHERE u.role = 'agent' AND u.deleted_at IS NULL AND u.is_active
  ),
  q AS (
    SELECT o.assigned_to AS agent_id,
      floor(extract(epoch FROM v_now - COALESCE(o.assigned_at, o.created_at)) / 60)::int AS held_min,
      EXISTS (
        SELECT 1 FROM order_history h
        WHERE h.order_id = o.id AND h.actor_id = o.assigned_to
          AND h.created_at >= COALESCE(o.assigned_at, o.created_at)
          AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected')
      ) AS called
    FROM orders o
    JOIN agents a ON a.id = o.assigned_to
    WHERE o.market_id = a.market_id
      AND o.status IN ('pending','new','assigned','attempt_1','attempt_2','attempt_3','callback_scheduled')
  ),
  per AS (
    SELECT a.id, a.full_name, a.market_id, a.last_seen_at, a.idle_min,
      count(q.agent_id) FILTER (WHERE NOT q.called AND q.held_min > a.call_h * 60) AS uncalled,
      max(q.held_min) FILTER (WHERE NOT q.called AND q.held_min > a.call_h * 60) AS oldest_min,
      count(q.agent_id) FILTER (WHERE NOT q.called) AS to_call,
      (SELECT max(h.created_at) FROM order_history h
        WHERE h.actor_id = a.id
          AND h.created_at >= (((v_now AT TIME ZONE a.tz)::date)::timestamp AT TIME ZONE a.tz)
          AND h.status_to IN ('attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed','rejected','uploaded')) AS last_today
    FROM agents a
    LEFT JOIN q ON q.agent_id = a.id
    GROUP BY a.id, a.full_name, a.market_id, a.last_seen_at, a.idle_min, a.tz
  )
  SELECT jsonb_build_object(
    'computed_at', v_now,
    'markets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'market_id', mk.id,
        'call_delay_hours', mk.call_h,
        'idle_minutes', mk.idle_min,
        'last_order_at', (SELECT max(o.created_at) FROM orders o WHERE o.market_id = mk.id),
        'agents', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'agent_id', p.id, 'name', p.full_name,
            'uncalled', p.uncalled, 'oldest_min', p.oldest_min, 'to_call', p.to_call,
            -- Online by heartbeat (< 5 min), worked today, silent for idle_minutes or more.
            'idle_since', CASE
              WHEN p.last_seen_at >= v_now - interval '5 minutes'
               AND p.last_today IS NOT NULL
               AND p.last_today <= v_now - make_interval(mins => p.idle_min)
              THEN p.last_today END
          ) ORDER BY p.full_name)
          FROM per p
          WHERE p.market_id = mk.id
            AND (p.uncalled > 0 OR (p.last_seen_at >= v_now - interval '5 minutes'
                                    AND p.last_today IS NOT NULL
                                    AND p.last_today <= v_now - make_interval(mins => p.idle_min)))
        ), '[]'::jsonb)
      ))
      FROM mk
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_alerts(uuid) IS
  'Salle de contrôle bell: per market, the last order received and the agents with orders not called N h after assignment or online without calling. NULL market = all markets (super_admin only).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. SECURITY DEFINER functions are executable by PUBLIC by default: revoke
-- first, then open to signed-in users only (memory: anon-executable RPCs).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_team_day(uuid, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_funnel(uuid, date, date, text, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_agent_panel(uuid, uuid, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_alerts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_day(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_funnel(uuid, date, date, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_agent_panel(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_alerts(uuid) TO authenticated;
