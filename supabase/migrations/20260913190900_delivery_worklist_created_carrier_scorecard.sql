-- ============================================================
-- 20260926000008_delivery_worklist_created_carrier_scorecard.sql
-- What the approved screen shows that the worklist did not return.
--
-- 1. get_delivery_worklist gains `created_at` ("Créé le" in the detail panel)
--    and `carrier_name` (the Transporteur card). The return type changes, so
--    the function is dropped and recreated; bucket logic is untouched and is
--    copied verbatim from 20260926000006.
-- 2. get_delivery_agent_scorecard — the "85 % livraison 30 j · 6 sauvées"
--    pill. Attribution is ownership (assigned_to), per decision 1 of
--    plans/suivi-livraison.md; commissions keep their stricter rule for pay.
--    "Saved" = delivered orders on which a person acted while the parcel was
--    returning, delayed, or flagged no-answer. SECURITY INVOKER: an agent can
--    only ever count their own orders, whatever id is passed.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_delivery_worklist(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_delivery_worklist(
  p_market_id uuid,
  p_agent_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  order_id            uuid,
  external_id         text,
  status              text,
  bucket              text,
  reason_codes        text[],
  hours_on_status     numeric,
  next_action_at      timestamptz,
  is_risky            boolean,
  risk_reasons        text[],
  total_price         numeric,
  customer_name       text,
  customer_phone      text,
  customer_phone_2    text,
  customer_city       text,
  customer_address    text,
  assigned_to         uuid,
  agent_name          text,
  tracking_number     text,
  carrier_id          uuid,
  carrier_status_slug text,
  latest_remark       text,
  latest_remark_at    timestamptz,
  remark_class        text,
  delayed_until       timestamptz,
  resend_count        integer,
  handler_name        text,
  handler_phone       text,
  handler_account_name  text,
  handler_account_phone text,
  to_branch_group     text,
  latest_event_at     timestamptz,
  customer_orders_count   integer,
  customer_delivered_count integer,
  customer_returned_count  integer,
  customer_rejected_count  integer,
  customer_risk_class      text,
  last_action_at      timestamptz,
  last_action_type    text,
  last_action_outcome text,
  last_action_note    text,
  has_open_task       boolean,
  terminal_at         timestamptz,
  created_at          timestamptz,
  carrier_name        text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH cfg AS (
  SELECT
    public.delivery_setting_int(p_market_id, 'carrier_stall_days', 5)            AS stall_days,
    public.delivery_setting_int(p_market_id, 'delivery_done_window_hours', 24)   AS done_hours
),
scope AS (
  SELECT o.*
  FROM public.orders o, cfg
  WHERE o.market_id = p_market_id
    AND o.archived_at IS NULL
    AND (p_agent_id IS NULL OR o.assigned_to = p_agent_id)
    -- Legacy dead uploads. 391 Libyan orders carry a 7-digit pre-sticker
    -- tracking number and NO carrier shipment, created May-Aug and averaging
    -- 105 days old; one agent owns 262 of them. They cannot move, because
    -- nothing at the carrier is tracking them. Showing them would bury the ~60
    -- real parcels and teach agents the page is noise — the way the old
    -- follow-ups page died. Nothing is archived or modified: an order that is
    -- still young, or that ever gets a real shipment, appears immediately.
    AND NOT (
      o.status = 'uploaded'
      -- created_at, NOT updated_at: the 2026-09-13 bulk write reset updated_at
      -- on all 391 rows, so the column that should have revealed their age is
      -- the one column that hides it.
      AND o.created_at < now() - make_interval(days => cfg.stall_days)
      AND NOT EXISTS (
        SELECT 1 FROM public.darb_shipments dsx WHERE dsx.order_id = o.id
      )
    )
    AND (
      o.status IN ('uploaded','scanned','at_carrier','dispatched','deposit',
                   'in_transit','out_for_delivery','delivery_delayed','unverified',
                   'returning','to_be_returned','received')
      OR (
        o.status IN ('delivered','returned','rejected','cancelled')
        AND o.terminal_at IS NOT NULL
        AND o.terminal_at >= now() - make_interval(hours => cfg.done_hours)
      )
    )
),
enriched AS (
  SELECT
    s.*,
    ds.status_slug, ds.latest_remark, ds.latest_remark_at, ds.remark_class,
    ds.delayed_until, ds.resend_count, ds.handler_name, ds.handler_phone,
    ds.handler_account_name, ds.handler_account_phone, ds.to_branch_group,
    ds.latest_event_at,
    c.orders_count, c.delivered_count, c.returned_count, c.rejected_count, c.risk_class,
    u.full_name AS agent_name,
    car.name    AS carrier_name,
    la.created_at  AS last_action_at,
    la.action_type AS last_action_type,
    la.outcome     AS last_action_outcome,
    la.note        AS last_action_note,
    nx.next_action_at AS pending_next_at,
    (task.id IS NOT NULL) AS has_open_task,
    -- The clock the "nothing has moved" rule reads, best source first.
    COALESCE(ds.latest_event_at, s.carrier_status_synced_at, s.updated_at) AS moved_at
  FROM scope s
  LEFT JOIN LATERAL (
    SELECT d.* FROM public.darb_shipments d
    WHERE d.order_id = s.id
    ORDER BY d.last_synced_at DESC LIMIT 1
  ) ds ON true
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.users u ON u.id = s.assigned_to
  LEFT JOIN public.carriers car ON car.id = s.carrier_id
  -- Last thing a HUMAN did. System rows (the proactive task itself) must not
  -- count as an answer to a remark, or raising a task would silence it.
  LEFT JOIN LATERAL (
    SELECT a.* FROM public.delivery_actions a
    WHERE a.order_id = s.id AND a.actor_type <> 'system'
    ORDER BY a.created_at DESC LIMIT 1
  ) la ON true
  -- Most recent scheduled next step, whoever set it.
  LEFT JOIN LATERAL (
    SELECT a.next_action_at FROM public.delivery_actions a
    WHERE a.order_id = s.id AND a.next_action_at IS NOT NULL
    ORDER BY a.created_at DESC LIMIT 1
  ) nx ON true
  -- An open proactive task: raised, never answered, never expired.
  LEFT JOIN LATERAL (
    SELECT t.id FROM public.delivery_actions t
    WHERE t.order_id = s.id
      AND t.action_type = 'proactive_call_task'
      AND t.outcome = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_actions d2
        WHERE d2.order_id = s.id
          AND d2.created_at > t.created_at
          AND (d2.actor_type <> 'system' OR d2.outcome = 'expired')
      )
    ORDER BY t.created_at DESC LIMIT 1
  ) task ON true
),
flagged AS (
  SELECT e.*,
         cfg.stall_days,
         -- An actionable remark the agent has not answered yet.
         (e.remark_class IN ('no_answer','customer_cancelled','not_needed','refused',
                             'not_serious','no_cash','wrong_item','payment_method',
                             'out_of_coverage','wrong_address')
          AND e.latest_remark_at IS NOT NULL
          AND (e.last_action_at IS NULL OR e.last_action_at < e.latest_remark_at)
         ) AS remark_unanswered,
         (e.status IN ('delivery_delayed','unverified')
          AND (e.last_action_at IS NULL OR e.last_action_at < e.moved_at)
         ) AS delay_unanswered,
         (e.pending_next_at IS NOT NULL AND e.pending_next_at <= now()) AS callback_due,
         (e.moved_at IS NOT NULL
          AND e.moved_at < now() - make_interval(days => cfg.stall_days)
          AND e.status NOT IN ('delivered','returned','rejected','cancelled')
         ) AS stalled
  FROM enriched e, cfg
)
SELECT
  f.id,
  f.external_id,
  f.status::text,
  CASE
    WHEN f.status IN ('delivered','returned','rejected','cancelled') THEN 'done'
    WHEN f.status IN ('returning','to_be_returned','received')
      OR f.status_slug = 'returning' THEN 'returning'
    WHEN f.has_open_task
      OR f.remark_unanswered
      OR f.delay_unanswered
      OR f.callback_due
      OR f.stalled THEN 'act_now'
    WHEN f.pending_next_at IS NOT NULL AND f.pending_next_at > now() THEN 'waiting_customer'
    ELSE 'waiting_carrier'
  END AS bucket,
  -- Why it is where it is. The UI turns these into the chips on the card.
  ARRAY_REMOVE(ARRAY[
    CASE WHEN f.has_open_task     THEN 'proactive'  END,
    CASE WHEN f.remark_unanswered THEN 'remark:' || f.remark_class END,
    CASE WHEN f.delay_unanswered  THEN 'delayed'    END,
    CASE WHEN f.callback_due      THEN 'callback_due' END,
    CASE WHEN f.stalled           THEN 'stalled:' || f.stall_days::text END,
    CASE WHEN f.status IN ('returning','to_be_returned','received')
           OR f.status_slug = 'returning' THEN 'returning' END,
    CASE WHEN f.status IN ('uploaded','scanned') THEN 'at_warehouse' END
  ], NULL) AS reason_codes,
  round(EXTRACT(EPOCH FROM (now() - COALESCE(f.moved_at, f.updated_at))) / 3600.0, 1),
  f.pending_next_at,
  COALESCE((public.evaluate_delivery_risk(f.id)->>'risky')::boolean, false),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(
            public.evaluate_delivery_risk(f.id)->'reasons')), '{}'::text[]),
  f.total_price,
  f.customer_name, f.customer_phone, f.customer_phone_2, f.customer_city, f.customer_address,
  f.assigned_to, f.agent_name,
  f.tracking_number, f.carrier_id, f.status_slug,
  f.latest_remark, f.latest_remark_at, f.remark_class, f.delayed_until, f.resend_count,
  f.handler_name, f.handler_phone, f.handler_account_name, f.handler_account_phone,
  f.to_branch_group, f.latest_event_at,
  f.orders_count, f.delivered_count, f.returned_count, f.rejected_count, f.risk_class,
  f.last_action_at, f.last_action_type, f.last_action_outcome, f.last_action_note,
  f.has_open_task,
  f.terminal_at,
  f.created_at,
  f.carrier_name
FROM flagged f
ORDER BY
  CASE
    WHEN f.status IN ('delivered','returned','rejected','cancelled') THEN 5
    WHEN f.status IN ('returning','to_be_returned','received')
      OR f.status_slug = 'returning' THEN 1
    WHEN f.has_open_task OR f.remark_unanswered OR f.delay_unanswered
      OR f.callback_due OR f.stalled THEN 2
    WHEN f.pending_next_at IS NOT NULL AND f.pending_next_at > now() THEN 3
    ELSE 4
  END,
  COALESCE(f.moved_at, f.updated_at) ASC;
$$;

REVOKE ALL ON FUNCTION public.get_delivery_worklist(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_delivery_worklist(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_delivery_worklist(uuid, uuid) IS
  'The agent post-upload worklist. Bucket precedence mirrors prototypes/suivi-livraison-v1.html.';


CREATE OR REPLACE FUNCTION public.get_delivery_agent_scorecard(
  p_agent_id uuid DEFAULT NULL,
  p_days     integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH me AS (
  SELECT COALESCE(p_agent_id, auth.uid()) AS id
),
fin AS (
  SELECT o.id, o.status::text AS st
  FROM public.orders o, me
  WHERE o.assigned_to = me.id
    AND o.status IN ('delivered', 'returned')
    AND o.terminal_at IS NOT NULL
    AND o.terminal_at >= now() - make_interval(days => p_days)
)
SELECT jsonb_build_object(
  'delivered', count(*) FILTER (WHERE st = 'delivered'),
  'returned',  count(*) FILTER (WHERE st = 'returned'),
  'delivery_rate',
    CASE WHEN count(*) > 0
         THEN round(100.0 * count(*) FILTER (WHERE st = 'delivered') / count(*))
    END,
  'saved', (
    SELECT count(*) FROM fin f
    WHERE f.st = 'delivered'
      AND EXISTS (
        SELECT 1 FROM public.delivery_actions a
        WHERE a.order_id = f.id
          AND a.actor_type <> 'system'
          AND (a.status_at_action::text IN ('returning', 'to_be_returned', 'delivery_delayed')
               OR a.remark_class_at_action = 'no_answer')
      )
  ),
  'window_days', p_days
)
FROM fin;
$$;

REVOKE ALL ON FUNCTION public.get_delivery_agent_scorecard(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_delivery_agent_scorecard(uuid, integer) TO authenticated;
