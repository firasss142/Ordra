-- ============================================================
-- 20260926000004_delivery_actions.sql
-- `delivery_actions` — what the agent actually DID about a parcel.
--
-- WHY: after upload an order leaves the agent's world entirely. The agent queue
-- stops at dispatch_scheduled, /in-delivery redirects agents, and the team
-- doctrine is "upload is the outcome". Yet commissions pay on `delivered`, and
-- the agent is the only person who calls the customer, the courier or the Darb
-- branch — today from a personal phone, leaving no trace anywhere. So the work
-- that decides whether a parcel lands is the one thing the system cannot see.
--
-- WHAT: an append-only ledger of the three real actions (call the customer,
-- call the courier or branch, message on WhatsApp), each with a structured
-- outcome, an optional note and an optional next step.
--
-- WHY A LEDGER AND NOT COLUMNS ON `orders`: agents are RLS-blocked on orders
-- past `uploaded` (that block is deliberate and stays), a write to orders would
-- re-fire the lock guard and the broadcast trigger, and "what happened" is a
-- history, not a current value. The old order_follow_ups tried the column
-- approach and its outcomes were never persisted at all.
--
-- THE SNAPSHOTS ARE THE POINT: status_at_action / carrier_slug_at_action /
-- remark_class_at_action freeze what the parcel looked like when the agent
-- acted. Without them "deliveries saved" — the number that finally measures an
-- agent on delivery rather than upload — would need history replayed per row.
--
-- No INSERT policy exists. Every write goes through record_delivery_action so
-- the scope and ownership rules cannot be bypassed by a raw PostgREST call.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.delivery_actions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id               uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  order_id                uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id             uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  actor_id                uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_type              text NOT NULL CHECK (actor_type IN ('agent', 'manager', 'system')),
  action_type             text NOT NULL CHECK (action_type IN (
                            'call_customer', 'call_courier', 'call_branch',
                            'whatsapp_customer', 'note', 'proactive_call_task')),
  channel                 text NOT NULL DEFAULT 'none'
                            CHECK (channel IN ('phone', 'whatsapp', 'none')),
  outcome                 text NOT NULL DEFAULT 'none' CHECK (outcome IN (
                            -- customer calls
                            'reached_will_receive', 'reached_reschedule',
                            'reached_wants_cancel', 'reached_address_fix',
                            'no_answer', 'wrong_number', 'phone_off',
                            -- courier / branch calls
                            'reattempt_promised', 'courier_no_answer',
                            'parcel_located', 'return_confirmed', 'info_passed',
                            -- system / messaging
                            'sent', 'pending', 'expired', 'none')),
  note                    text CHECK (note IS NULL OR length(note) <= 500),
  template_key            text,
  next_action_at          timestamptz,
  status_at_action        order_status,
  carrier_slug_at_action  text,
  remark_class_at_action  text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.delivery_actions IS
  'Append-only. What an agent did about a parcel after upload. Written only by record_delivery_action.';
COMMENT ON COLUMN public.delivery_actions.status_at_action IS
  'Order status when the action was recorded. Makes "deliveries saved" computable without replaying history.';

-- The worklist reads the LAST action per order; the scorecard reads an agent's
-- actions over a window; the notification cron reads what is due.
CREATE INDEX IF NOT EXISTS idx_delivery_actions_order
  ON public.delivery_actions (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_actions_actor
  ON public.delivery_actions (market_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_actions_due
  ON public.delivery_actions (market_id, next_action_at)
  WHERE next_action_at IS NOT NULL;

-- Append-only by the same trigger function that guards inventory_log and
-- order_history (20260922000001). Raises even for service_role: a correction is
-- a new compensating row, never an edit of what was recorded.
DROP TRIGGER IF EXISTS trg_delivery_actions_append_only ON public.delivery_actions;
CREATE TRIGGER trg_delivery_actions_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_actions
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Read: super_admin everywhere; managers their market; agents only rows on
-- orders they own. No INSERT/UPDATE/DELETE policy — writes go through the RPC.

ALTER TABLE public.delivery_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_actions_select ON public.delivery_actions;
CREATE POLICY delivery_actions_select ON public.delivery_actions
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() = 'market_manager'
      AND market_id = public.get_user_market_id()
    )
    OR (
      public.get_user_role() = 'agent'
      AND market_id = public.get_user_market_id()
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = delivery_actions.order_id
          AND o.assigned_to = auth.uid()
      )
    )
  );

-- ── Settings helper ─────────────────────────────────────────────────────────
-- Settings are stored as {"value": N}; this is the read idiom from
-- 015_session9_no_response_rpc.sql, wrapped so every delivery function reads a
-- threshold the same way and none of them hardcodes one.

CREATE OR REPLACE FUNCTION public.delivery_setting_int(
  p_market_id uuid,
  p_key       text,
  p_default   integer
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT (s.value->>'value')::integer
     FROM public.settings s
     WHERE s.market_id = p_market_id AND s.key = p_key),
    p_default
  );
$$;

COMMENT ON FUNCTION public.delivery_setting_int(uuid, text, integer) IS
  'Reads an integer market setting, falling back to the given default. Never hardcode a threshold.';

-- ── record_delivery_action ──────────────────────────────────────────────────
--
-- SECURITY DEFINER because agents cannot read orders past `uploaded` under RLS
-- and must still be able to log what they did. The function therefore does the
-- scoping itself, and does it strictly:
--   * the order must be in flight (uploaded onward) or terminal within the
--     done window — an agent cannot annotate an order from three months ago;
--   * an agent caller must own the order;
--   * a manager caller must share its market;
--   * only actor_type 'system' may pass a NULL actor.
-- It never writes `orders`. That is the whole reason it exists.

CREATE OR REPLACE FUNCTION public.record_delivery_action(
  p_order_id       uuid,
  p_action_type    text,
  p_channel        text DEFAULT 'none',
  p_outcome        text DEFAULT 'none',
  p_note           text DEFAULT NULL,
  p_next_action_at timestamptz DEFAULT NULL,
  p_template_key   text DEFAULT NULL,
  p_actor_id       uuid DEFAULT NULL,
  p_actor_type     text DEFAULT 'agent'
)
RETURNS public.delivery_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order       public.orders;
  v_slug        text;
  v_remark      text;
  v_done_window integer;
  v_actor_role  text;
  v_row         public.delivery_actions;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found'
      USING ERRCODE = 'P0002', DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  -- Actor identity. A NULL actor is only ever a system write (cron, trigger).
  IF p_actor_type = 'system' THEN
    IF p_actor_id IS NOT NULL THEN
      RAISE EXCEPTION 'system_action_must_not_name_an_actor'
        USING ERRCODE = '22023', DETAIL = '{"code":"SYSTEM_ACTOR_CONFLICT"}';
    END IF;
  ELSE
    IF p_actor_id IS NULL THEN
      RAISE EXCEPTION 'actor_required'
        USING ERRCODE = '22023', DETAIL = '{"code":"ACTOR_REQUIRED"}';
    END IF;

    SELECT u.role::text INTO v_actor_role FROM public.users u WHERE u.id = p_actor_id;
    IF v_actor_role IS NULL THEN
      RAISE EXCEPTION 'actor_not_found'
        USING ERRCODE = 'P0002', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
    END IF;

    -- An agent may only act on their own parcels. Ownership survives upload:
    -- assigned_to is nulled only by unassign_order / return_order_to_pool,
    -- both gated to pre-fulfilment statuses.
    IF v_actor_role = 'agent' AND v_order.assigned_to IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'not_your_order'
        USING ERRCODE = '42501', DETAIL = '{"code":"NOT_ORDER_OWNER"}';
    END IF;

    IF v_actor_role IN ('market_manager', 'warehouse_agent')
       AND (SELECT u.market_id FROM public.users u WHERE u.id = p_actor_id)
           IS DISTINCT FROM v_order.market_id THEN
      RAISE EXCEPTION 'wrong_market'
        USING ERRCODE = '42501', DETAIL = '{"code":"WRONG_MARKET"}';
    END IF;
  END IF;

  -- Scope: in flight, or terminal but still inside the "done" window so an
  -- agent can log the call that closed it.
  v_done_window := public.delivery_setting_int(
                     v_order.market_id, 'delivery_done_window_hours', 24);

  IF NOT (
    v_order.status::text IN (
      'uploaded', 'scanned', 'at_carrier', 'dispatched', 'deposit', 'in_transit',
      'out_for_delivery', 'delivery_delayed', 'unverified', 'returning',
      'to_be_returned', 'received')
    OR (
      v_order.status::text IN ('delivered', 'returned', 'rejected', 'cancelled')
      AND v_order.terminal_at IS NOT NULL
      AND v_order.terminal_at >= now() - make_interval(hours => v_done_window)
    )
  ) THEN
    RAISE EXCEPTION 'order_out_of_delivery_scope'
      USING ERRCODE = '22023',
            DETAIL  = json_build_object('code', 'OUT_OF_SCOPE',
                                        'status', v_order.status::text)::text;
  END IF;

  -- Snapshot the parcel as it was at the moment of the action.
  SELECT ds.status_slug, ds.remark_class
    INTO v_slug, v_remark
    FROM public.darb_shipments ds
   WHERE ds.order_id = p_order_id
   ORDER BY ds.last_synced_at DESC
   LIMIT 1;

  INSERT INTO public.delivery_actions (
    market_id, order_id, customer_id, actor_id, actor_type, action_type,
    channel, outcome, note, template_key, next_action_at,
    status_at_action, carrier_slug_at_action, remark_class_at_action
  ) VALUES (
    v_order.market_id, p_order_id, v_order.customer_id, p_actor_id, p_actor_type,
    p_action_type, p_channel, p_outcome, NULLIF(btrim(p_note), ''), p_template_key,
    p_next_action_at, v_order.status, v_slug, v_remark
  )
  RETURNING * INTO v_row;

  -- Acting on a parcel answers whatever the bell was nagging about.
  UPDATE public.agent_notifications
     SET read_at = now()
   WHERE order_id = p_order_id
     AND read_at IS NULL
     AND kind IN ('proactive_call_due', 'delivery_action_due',
                  'parcel_returning', 'courier_remark');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_delivery_action(
  uuid, text, text, text, text, timestamptz, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_delivery_action(
  uuid, text, text, text, text, timestamptz, text, uuid, text) TO authenticated;
