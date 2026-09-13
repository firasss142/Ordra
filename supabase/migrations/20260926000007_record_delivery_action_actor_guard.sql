-- ============================================================
-- 20260926000007_record_delivery_action_actor_guard.sql
-- record_delivery_action trusted the p_actor_id its caller passed. It is
-- SECURITY DEFINER and granted to `authenticated`, so an agent could call it
-- with a manager's id (or as 'system') and the ledger would record a lie.
-- Found while wiring the API route, reproduced on production inside a rolled
-- back transaction, fixed here: a signed-in caller can only be themselves.
-- ============================================================

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

  -- The caller's session is the only identity source. p_actor_id exists for
  -- server-side callers (cron, triggers, service role) that have no session;
  -- a signed-in caller may name only themselves, and may never write a
  -- 'system' row. Without this, any authenticated user could log an action
  -- under a manager's name (verified on production before the fix).
  IF auth.uid() IS NOT NULL THEN
    IF p_actor_type = 'system' OR p_actor_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'actor_must_be_caller'
        USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_SPOOF"}';
    END IF;
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

    -- The label follows the role, never the caller's say-so.
    IF (v_actor_role = 'agent') <> (p_actor_type = 'agent') THEN
      RAISE EXCEPTION 'actor_type_does_not_match_role'
        USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_TYPE_MISMATCH"}';
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
