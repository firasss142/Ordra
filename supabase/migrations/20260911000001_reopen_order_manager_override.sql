-- ============================================================
-- 20260911000001_reopen_order_manager_override.sql
-- reopen_order: let managers reopen, and stop misattributing them.
--
-- Background: the function required `assigned_to = p_actor_id` and
-- hardcoded actor_type = 'agent' on the history row. A manager is
-- never the assignee, so an uploaded order reopened cleanly from the
-- agent queue and raised 'Order not assigned to actor' from the
-- orders page — the bug this migration exists to fix.
--
-- What changes:
--   * new p_actor_type argument ('agent' | 'manager'), matching the
--     order_history CHECK, which allows only system | agent | manager.
--     super_admin maps to 'manager' in app code (lib/orders/manager-takeover).
--   * ownership is checked ONLY for 'agent'. So is the 7-day window:
--     both are guardrails on the agent, not a rule about what a
--     manager may correct.
--   * the history row records the real actor_type, so an append-only
--     table stops recording managers as agents.
--
-- What does NOT change: the reopenable status set. That rule binds
-- everyone — reopening wipes the carrier fields, and resurrecting a
-- delivered order would strand a shipment that already arrived.
--
-- The 3-arg version is dropped first. CREATE OR REPLACE with a
-- different argument count creates an OVERLOAD rather than replacing,
-- and a 3-arg call would then match both candidates — PostgREST fails
-- with "Could not choose the best candidate function between: ...".
-- Same trap as 20260506010000_drop_legacy_transition_overload.sql.
-- ============================================================

DROP FUNCTION IF EXISTS public.reopen_order(uuid, uuid, text);

CREATE OR REPLACE FUNCTION reopen_order(
  p_order_id     UUID,
  p_actor_id     UUID,
  p_void_outcome TEXT DEFAULT 'no_barcode',  -- 'carrier_voided' | 'local_only' | 'no_barcode'
  p_actor_type   TEXT DEFAULT 'agent'        -- 'agent' | 'manager'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id    UUID;
  v_status      order_status;
  v_assigned_to UUID;
  v_updated_at  TIMESTAMPTZ;
  v_history_note TEXT;
BEGIN
  IF p_actor_type NOT IN ('agent', 'manager') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT id, status, assigned_to, updated_at
    INTO v_order_id, v_status, v_assigned_to, v_updated_at
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Agent-only gates. The route enforces market scope for managers before
  -- it gets here; this function is SECURITY DEFINER and is never called
  -- from the browser.
  IF p_actor_type = 'agent' THEN
    IF v_assigned_to IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Order not assigned to actor';
    END IF;

    IF v_updated_at < NOW() - INTERVAL '7 days' THEN
      RAISE EXCEPTION 'Reopen window expired (updated_at = %)', v_updated_at;
    END IF;
  END IF;

  -- Binds every actor: reopening clears the carrier fields.
  IF v_status NOT IN ('rejected', 'uploaded', 'dispatched') THEN
    RAISE EXCEPTION 'Cannot reopen order in status %', v_status;
  END IF;

  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Reouvert - code-barres annule chez transporteur'
    WHEN 'local_only'     THEN 'Reouvert - annulation transporteur echouee, coordination manuelle requise'
    ELSE CASE p_actor_type
      WHEN 'manager' THEN 'Reouvert par manager'
      ELSE                'Reouvert par agent'
    END
  END;

  UPDATE orders
  SET
    status = 'pending',
    tracking_number = NULL,
    carrier_id = NULL,
    carrier_extra = NULL,
    rejection_reason = NULL,
    rejection_note = NULL,
    updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_status, 'pending'::order_status, p_actor_id, p_actor_type, v_history_note);

  RETURN json_build_object(
    'order_id',     p_order_id,
    'from_status',  v_status,
    'void_outcome', p_void_outcome
  );
END;
$$;
