-- ============================================================
-- 20260926000006_delivery_worklist.sql
-- evaluate_delivery_risk + get_delivery_worklist — the ranking itself.
--
-- This is the prototype's bucket engine moved into SQL. The prototype computed
-- it client-side over 16 fixture parcels; doing that over a real agent's 20-60
-- live parcels would mean shipping every carrier event, every remark and every
-- action to the browser just to decide what to show first. The precedence is
-- identical to prototypes/suivi-livraison-v1.html, deliberately, so the page
-- the owner approved is the page that gets built.
--
-- BUCKETS, first match wins:
--   done             terminal, inside delivery_done_window_hours
--   returning        the parcel is coming back — a branch call often earns one
--                    more attempt, so it outranks everything still in flight
--   act_now          an open proactive task; OR an actionable courier remark
--                    newer than the agent's last action; OR delayed/unverified
--                    with no action since; OR a callback that has come due; OR
--                    nothing has moved for carrier_stall_days
--   waiting_customer a next action is set and still in the future
--   waiting_carrier  everything else
--
-- "newer than the agent's last action" is the load-bearing idea in act_now: a
-- remark the agent has already answered must NOT keep the parcel at the top of
-- the list, or the page becomes a wall of things already handled and agents
-- stop reading it. That is precisely how the old follow-ups page died.
--
-- SECURITY INVOKER: market isolation comes from the RLS policies on `orders`
-- and `customers`, exactly as the plan specifies. The function adds the
-- agent-ownership filter on top; it cannot widen what RLS already allows.
-- ============================================================

-- ── Risk, for the proactive call ────────────────────────────────────────────
-- Three inputs, and deliberately NOT "first-time customer": flagging every new
-- buyer would mark most of the list and teach agents to ignore the mark.

CREATE OR REPLACE FUNCTION public.evaluate_delivery_risk(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order     public.orders;
  v_cust      public.customers;
  v_reasons   text[] := '{}';
  v_min_fail  integer;
  v_high      numeric;
  v_pct       integer;
  v_min_samp  integer;
  v_zone_key  text;
  v_zone      public.delivery_zone_stats;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('risky', false, 'reasons', '[]'::jsonb);
  END IF;

  v_min_fail := public.delivery_setting_int(v_order.market_id, 'risk_min_prior_failures', 1);
  v_high     := public.delivery_setting_int(v_order.market_id, 'high_value_threshold', 0);
  v_pct      := public.delivery_setting_int(v_order.market_id, 'zone_low_delivery_rate_pct', 60);
  v_min_samp := public.delivery_setting_int(v_order.market_id, 'zone_min_sample', 20);

  -- 1. The customer has failed us before.
  IF v_order.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_order.customer_id;
    IF FOUND AND (COALESCE(v_cust.returned_count, 0) + COALESCE(v_cust.rejected_count, 0))
                 >= v_min_fail THEN
      v_reasons := v_reasons || 'repeat_risk'::text;
    END IF;
  END IF;

  -- 2. Losing this one costs more than average. 0 = the market opted out.
  IF v_high > 0 AND COALESCE(v_order.total_price, 0) >= v_high THEN
    v_reasons := v_reasons || 'high_value'::text;
  END IF;

  -- 3. The destination itself loses parcels — but only once enough finished
  -- orders exist for the rate to mean anything.
  v_zone_key := public.delivery_zone_key(
                  v_order.darb_destination_id::text, v_order.city_id, v_order.customer_city);
  IF v_zone_key IS NOT NULL THEN
    SELECT * INTO v_zone
      FROM public.delivery_zone_stats
     WHERE market_id = v_order.market_id AND zone_key = v_zone_key;
    IF FOUND AND v_zone.sample >= v_min_samp
       AND (v_zone.delivery_rate * 100) < v_pct THEN
      v_reasons := v_reasons || 'low_zone'::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'risky',   array_length(v_reasons, 1) IS NOT NULL,
    'reasons', to_jsonb(v_reasons));
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_delivery_risk(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_delivery_risk(uuid) TO authenticated;

-- ── The worklist ────────────────────────────────────────────────────────────

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
  terminal_at         timestamptz
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
  f.terminal_at
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
