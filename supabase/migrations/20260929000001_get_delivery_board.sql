-- ============================================================
-- 20260929000001_get_delivery_board.sql
-- The manager board of « Suivi livraison » (plan phase 4, decision 40).
--
-- WHY: the worklist RPC already gives a manager every parcel in the market.
-- What it cannot give is what each AGENT did today — the ledger holds one row
-- per action, and the worklist carries only the last action per parcel. An
-- agent who called ten customers about ten parcels and an agent who called
-- once look identical from the rows alone.
--
-- WHAT: per-agent activity for the market — actions today, customers reached
-- today, WhatsApp sent today, parcels saved and lost this week, and a 7-day
-- action strip — plus the market's roster so an agent holding nothing today
-- still appears on the board.
--
-- The verdict itself is NOT computed here. It is decided in TypeScript
-- (src/lib/delivery/board.ts) against the parcels the worklist already
-- returned, so the rule a manager acts on is testable without a database.
--
-- "Today" and "this week" are on the MARKET's clock, not the server's: a
-- Libyan manager opening the board at 01:00 Tripoli must see Tripoli's day.
--
-- SECURITY INVOKER: RLS on delivery_actions and orders is the isolation,
-- exactly as get_delivery_worklist relies on. This shapes what the caller may
-- already read; it grants nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_delivery_board(
  p_market_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH tz AS (
  SELECT public.warehouse_market_tz(p_market_id) AS name
),
bounds AS (
  -- Start of today and of the current week (Monday), expressed as instants.
  SELECT
    (date_trunc('day',  (now() AT TIME ZONE t.name)) AT TIME ZONE t.name) AS day_start,
    (date_trunc('week', (now() AT TIME ZONE t.name)) AT TIME ZONE t.name) AS week_start,
    t.name AS tz_name
  FROM tz t
),
roster AS (
  SELECT u.id, COALESCE(NULLIF(btrim(u.full_name), ''), u.email) AS name
  FROM users u
  WHERE u.role = 'agent'
    AND u.market_id = p_market_id
    AND u.is_active
),
-- Every action an agent recorded in this market this week. Manager and system
-- rows are excluded: this measures the agents, and a manager's own call must
-- not make the agent look busy.
acts AS (
  SELECT a.actor_id, a.action_type, a.outcome, a.created_at
  FROM delivery_actions a, bounds b
  WHERE a.market_id = p_market_id
    AND a.actor_type = 'agent'
    AND a.actor_id IS NOT NULL
    AND a.created_at >= LEAST(b.week_start, b.day_start - interval '6 days')
),
today AS (
  SELECT
    a.actor_id,
    count(*) FILTER (WHERE a.action_type <> 'proactive_call_task') AS actions_today,
    count(*) FILTER (WHERE a.outcome IN ('reached_will_receive', 'reached_reschedule',
                                         'reached_wants_cancel', 'reached_address_fix')) AS reached_today,
    count(*) FILTER (WHERE a.action_type = 'whatsapp_customer') AS whatsapp_today
  FROM acts a, bounds b
  WHERE a.created_at >= b.day_start
  GROUP BY a.actor_id
),
-- The 7-day strip: one count per day on the market clock, today last. Days
-- with no action must still produce a 0, so the strip is generated from a date
-- series rather than from the rows that happen to exist.
week_days AS (
  SELECT
    r.id AS actor_id,
    d.offset_days,
    (SELECT count(*)
       FROM acts a, bounds b
      WHERE a.actor_id = r.id
        AND a.action_type <> 'proactive_call_task'
        AND a.created_at >= b.day_start - make_interval(days => d.offset_days)
        AND a.created_at <  b.day_start - make_interval(days => d.offset_days - 1)
    ) AS n
  FROM roster r
  CROSS JOIN generate_series(6, 0, -1) AS d(offset_days)
),
week_strip AS (
  SELECT actor_id, jsonb_agg(n ORDER BY offset_days DESC) AS week
  FROM week_days
  GROUP BY actor_id
),
-- Saved and lost this week, attributed to the parcel's CURRENT owner. Decision
-- 38 made ownership the attribution rule for delivery: a reassignment moves
-- the outcome with the parcel, which is also how the commission will follow.
-- "Saved" means the agent acted while the parcel was in trouble and it landed
-- anyway; without that condition every delivery would count as a save.
outcomes AS (
  SELECT
    o.assigned_to AS actor_id,
    count(*) FILTER (WHERE o.status = 'delivered' AND EXISTS (
      SELECT 1 FROM delivery_actions a
      WHERE a.order_id = o.id
        AND a.actor_type = 'agent'
        AND (a.status_at_action IN ('returning', 'to_be_returned', 'delivery_delayed', 'unverified')
             OR a.remark_class_at_action IN ('no_answer', 'out_of_coverage', 'not_needed',
                                             'customer_cancelled', 'not_serious'))
    )) AS saved_week,
    count(*) FILTER (WHERE o.status = 'returned') AS lost_week
  FROM orders o, bounds b
  WHERE o.market_id = p_market_id
    AND o.assigned_to IS NOT NULL
    AND o.status IN ('delivered', 'returned')
    AND o.terminal_at >= b.week_start
  GROUP BY o.assigned_to
)
SELECT jsonb_build_object(
  'agents', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'agent_id',       r.id,
        'name',           r.name,
        'actions_today',  COALESCE(t.actions_today, 0),
        'reached_today',  COALESCE(t.reached_today, 0),
        'whatsapp_today', COALESCE(t.whatsapp_today, 0),
        'saved_week',     COALESCE(oc.saved_week, 0),
        'lost_week',      COALESCE(oc.lost_week, 0),
        'week',           COALESCE(ws.week, '[0,0,0,0,0,0,0]'::jsonb)
      ) ORDER BY r.name
    )
    FROM roster r
    LEFT JOIN today    t  ON t.actor_id  = r.id
    LEFT JOIN outcomes oc ON oc.actor_id = r.id
    LEFT JOIN week_strip ws ON ws.actor_id = r.id
  ), '[]'::jsonb),
  'target_hours', COALESCE(
    public.delivery_setting_int(p_market_id, 'delivery_first_action_hours', 4), 4),
  'timezone', (SELECT tz_name FROM bounds),
  'generated_at', now()
);
$$;

COMMENT ON FUNCTION public.get_delivery_board(uuid) IS
  'Manager board of Suivi livraison: per-agent activity from delivery_actions on the market clock, '
  'plus the market roster and the delivery_first_action_hours target. The verdict is computed in '
  'src/lib/delivery/board.ts from the worklist rows. See plans/suivi-livraison.md decision 40.';

GRANT EXECUTE ON FUNCTION public.get_delivery_board(uuid) TO authenticated;
