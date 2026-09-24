-- ============================================================
-- 20260927000001_delivery_worklist_perf.sql
-- get_delivery_worklist: the same answer, computed once instead of twice, and
-- only for the parcels the screen is actually going to draw.
--
-- Measured on the live Libyan list (210 parcels) before this migration:
--   * the whole RPC                                        386 ms
--   * one pass of evaluate_delivery_risk() over those rows 138 ms
-- The SELECT called evaluate_delivery_risk(f.id) TWICE per row — once for
-- `risky`, once for `reasons` — so ~276 ms of the 386 ms was that function,
-- and half of it was computing an answer we already had. Each call is
-- SECURITY DEFINER plpgsql that re-reads four market settings, the order, the
-- customer and the zone row: all of which `enriched` has already joined.
--
-- THREE CHANGES, in order of what they buy:
--
-- 1. Risk becomes set-based, evaluated once per row inside the CTE chain from
--    columns already in hand. evaluate_delivery_risk() is NOT dropped — the
--    proactive-call trigger calls it per order, where a scalar function is the
--    right shape — so the rule now lives in two places. The equivalence is
--    asserted by supabase/tests/delivery_worklist_risk.test.sql, which fails
--    loudly if the two ever disagree on a real row.
--
-- 2. `p_include_done` (default true) lets the caller skip terminal parcels.
--    89 of the 210 live Libyan rows are `done` — 42% of the payload is parcels
--    that closed in the last 24 h and need nothing. The page fetches them
--    separately, only when the agent opens that tab.
--
-- 3. `p_limit` / `p_offset` (default NULL = everything) page the result, with
--    `total_count` carried on every row so the caller knows what it did not
--    receive. The ORDER BY is unchanged and fully deterministic — it gains
--    `f.id` as a final tiebreak, without which two parcels sharing a moved_at
--    could swap between pages and one would be shown twice while another
--    vanished.
--
-- Bucket precedence, reason codes and the scope filter are copied verbatim
-- from 20260926000008. The only intended behaviour change is what the three
-- new parameters do when a caller passes them.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_delivery_worklist(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_delivery_worklist(
  p_market_id    uuid,
  p_agent_id     uuid DEFAULT NULL,
  p_include_done boolean DEFAULT true,
  p_limit        integer DEFAULT NULL,
  p_offset       integer DEFAULT 0
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
  carrier_name        text,
  total_count         bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH cfg AS (
  SELECT
    public.delivery_setting_int(p_market_id, 'carrier_stall_days', 5)            AS stall_days,
    public.delivery_setting_int(p_market_id, 'delivery_done_window_hours', 24)   AS done_hours,
    -- Risk thresholds, read ONCE for the whole list instead of once per row
    -- inside evaluate_delivery_risk(). Same keys, same defaults.
    public.delivery_setting_int(p_market_id, 'risk_min_prior_failures', 1)       AS risk_min_fail,
    public.delivery_setting_int(p_market_id, 'high_value_threshold', 0)          AS high_value,
    public.delivery_setting_int(p_market_id, 'zone_low_delivery_rate_pct', 60)   AS zone_pct,
    public.delivery_setting_int(p_market_id, 'zone_min_sample', 20)              AS zone_min_sample
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
        -- Terminal parcels are the `done` tab. Skipping them here, rather than
        -- filtering later, is the point: it keeps them out of every lateral
        -- join below, not just out of the result.
        p_include_done
        AND o.status IN ('delivered','returned','rejected','cancelled')
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
    COALESCE(ds.latest_event_at, s.carrier_status_synced_at, s.updated_at) AS moved_at,
    -- ── Risk, inlined ──────────────────────────────────────────────────────
    -- Mirrors evaluate_delivery_risk() exactly, from columns already joined:
    -- the customer is `c`, the thresholds are in cfg, and only the zone row
    -- needs a join of its own. Deliberately NOT "first-time customer" —
    -- flagging every new buyer would mark most of the list and teach agents
    -- to ignore the mark.
    (c.id IS NOT NULL
     AND (COALESCE(c.returned_count, 0) + COALESCE(c.rejected_count, 0)) >= cfg.risk_min_fail
    ) AS risk_repeat,
    (cfg.high_value > 0 AND COALESCE(s.total_price, 0) >= cfg.high_value) AS risk_high_value,
    (z.zone_key IS NOT NULL
     AND z.sample >= cfg.zone_min_sample
     AND (z.delivery_rate * 100) < cfg.zone_pct
    ) AS risk_low_zone
  FROM scope s
  CROSS JOIN cfg
  LEFT JOIN LATERAL (
    SELECT d.* FROM public.darb_shipments d
    WHERE d.order_id = s.id
    ORDER BY d.last_synced_at DESC LIMIT 1
  ) ds ON true
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.users u ON u.id = s.assigned_to
  LEFT JOIN public.carriers car ON car.id = s.carrier_id
  -- The zone stats row for this parcel's destination, keyed exactly as
  -- delivery_zone_key() keys it (same precedence: darb → city → name).
  LEFT JOIN public.delivery_zone_stats z
    ON z.market_id = s.market_id
   AND z.zone_key = public.delivery_zone_key(
         s.darb_destination_id::text, s.city_id, s.customer_city)
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
         ) AS stalled,
         -- Same order as evaluate_delivery_risk() builds its array, so the
         -- reasons match element for element, not just as a set.
         ARRAY_REMOVE(ARRAY[
           CASE WHEN e.risk_repeat     THEN 'repeat_risk' END,
           CASE WHEN e.risk_high_value THEN 'high_value'  END,
           CASE WHEN e.risk_low_zone   THEN 'low_zone'    END
         ], NULL) AS risk_reasons
  FROM enriched e, cfg
),
ranked AS (
  SELECT f.*,
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
    END AS bucket_key,
    CASE
      WHEN f.status IN ('delivered','returned','rejected','cancelled') THEN 5
      WHEN f.status IN ('returning','to_be_returned','received')
        OR f.status_slug = 'returning' THEN 1
      WHEN f.has_open_task OR f.remark_unanswered OR f.delay_unanswered
        OR f.callback_due OR f.stalled THEN 2
      WHEN f.pending_next_at IS NOT NULL AND f.pending_next_at > now() THEN 3
      ELSE 4
    END AS bucket_rank,
    count(*) OVER () AS total_count
  FROM flagged f
)
SELECT
  r.id,
  r.external_id,
  r.status::text,
  r.bucket_key,
  -- Why it is where it is. The UI turns these into the chips on the card.
  ARRAY_REMOVE(ARRAY[
    CASE WHEN r.has_open_task     THEN 'proactive'  END,
    CASE WHEN r.remark_unanswered THEN 'remark:' || r.remark_class END,
    CASE WHEN r.delay_unanswered  THEN 'delayed'    END,
    CASE WHEN r.callback_due      THEN 'callback_due' END,
    CASE WHEN r.stalled           THEN 'stalled:' || r.stall_days::text END,
    CASE WHEN r.status IN ('returning','to_be_returned','received')
           OR r.status_slug = 'returning' THEN 'returning' END,
    CASE WHEN r.status IN ('uploaded','scanned') THEN 'at_warehouse' END
  ], NULL) AS reason_codes,
  round(EXTRACT(EPOCH FROM (now() - COALESCE(r.moved_at, r.updated_at))) / 3600.0, 1),
  r.pending_next_at,
  (array_length(r.risk_reasons, 1) IS NOT NULL) AS is_risky,
  r.risk_reasons,
  r.total_price,
  r.customer_name, r.customer_phone, r.customer_phone_2, r.customer_city, r.customer_address,
  r.assigned_to, r.agent_name,
  r.tracking_number, r.carrier_id, r.status_slug,
  r.latest_remark, r.latest_remark_at, r.remark_class, r.delayed_until, r.resend_count,
  r.handler_name, r.handler_phone, r.handler_account_name, r.handler_account_phone,
  r.to_branch_group, r.latest_event_at,
  r.orders_count, r.delivered_count, r.returned_count, r.rejected_count, r.risk_class,
  r.last_action_at, r.last_action_type, r.last_action_outcome, r.last_action_note,
  r.has_open_task,
  r.terminal_at,
  r.created_at,
  r.carrier_name,
  r.total_count
FROM ranked r
-- `r.id` last: without a unique tiebreak, two parcels sharing moved_at could
-- swap places between two page requests, showing one twice and losing another.
ORDER BY r.bucket_rank, COALESCE(r.moved_at, r.updated_at) ASC, r.id
LIMIT  p_limit
OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_delivery_worklist(uuid, uuid, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_delivery_worklist(uuid, uuid, boolean, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_delivery_worklist(uuid, uuid, boolean, integer, integer) IS
  'The agent post-upload worklist. Bucket precedence mirrors prototypes/suivi-livraison-v1.html. '
  'Risk is computed set-based here and must stay equivalent to evaluate_delivery_risk(); '
  'supabase/tests/delivery_worklist_risk.test.sql asserts that.';
