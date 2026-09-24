-- ============================================================
-- 20260505233818_pending_assignment_model.sql
-- Treat assignment as ownership (orders.assigned_to), not as an
-- order lifecycle status. Active assigned orders become pending with
-- an assignee; assigned remains as a legacy enum value for history.
-- ============================================================

-- The app already models dispatching as a transient carrier-dispatch state.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'dispatching' AFTER 'dispatch_scheduled';

COMMIT;
BEGIN;

-- Existing active rows that only mean "assigned but untouched" now
-- live in pending. Keep order_history untouched so old timelines still
-- reflect what happened at the time.
UPDATE orders
SET status = 'pending'
WHERE status = 'assigned';

-- The old partial index targeted the pre-rename 'new' status.
DROP INDEX IF EXISTS idx_orders_unassigned;

CREATE INDEX IF NOT EXISTS idx_orders_unassigned
  ON orders (market_id, created_at DESC)
  WHERE status = 'pending' AND assigned_to IS NULL;

-- Agents must be allowed to edit their assigned pending orders. The
-- warehouse migration already widened SELECT; refresh both policies here
-- so the current assignment model is explicit.
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select"
  ON orders FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
    OR (get_user_role() = 'warehouse_agent' AND market_id = get_user_market_id())
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN (
        'pending',
        'assigned',
        'attempt_1',
        'attempt_2',
        'attempt_3',
        'callback_scheduled',
        'confirmed',
        'dispatch_scheduled'
      )
    )
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN (
        'pending',
        'assigned',
        'attempt_1',
        'attempt_2',
        'attempt_3',
        'callback_scheduled',
        'confirmed',
        'dispatch_scheduled'
      )
    )
  );

-- Assignment now sets ownership only. Legacy 'new'/'assigned' rows are
-- normalized to pending; reassignment preserves the current workflow status.
CREATE OR REPLACE FUNCTION assign_order(
  p_order_id UUID,
  p_agent_id UUID,
  p_actor_id UUID,
  p_actor_type TEXT DEFAULT 'manager',
  p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_market_id UUID;
  v_old_agent UUID;
  v_history_id UUID;
  v_new_status order_status;
  v_updated_at TIMESTAMPTZ;
  v_agent_market_id UUID;
  v_note TEXT;
BEGIN
  SELECT id, status, market_id, assigned_to
    INTO v_order_id, v_current_status, v_market_id, v_old_agent
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  SELECT market_id INTO v_agent_market_id
  FROM users
  WHERE id = p_agent_id
    AND role = 'agent'
    AND is_active = true;

  IF v_agent_market_id IS NULL THEN
    RAISE EXCEPTION 'Agent not found or inactive: %', p_agent_id;
  END IF;

  IF v_agent_market_id != v_market_id THEN
    RAISE EXCEPTION 'Agent market does not match order market';
  END IF;

  v_new_status := CASE
    WHEN v_current_status IN ('new', 'assigned') THEN 'pending'::order_status
    ELSE v_current_status
  END;

  v_note := COALESCE(
    p_note,
    CASE
      WHEN v_old_agent IS NULL THEN 'Assigne a l''agent'
      ELSE 'Reassigne a l''agent'
    END
  );

  UPDATE orders
  SET
    assigned_to = p_agent_id,
    status = v_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, v_new_status, p_actor_id, p_actor_type, v_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', v_new_status,
    'assigned_to', p_agent_id,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- Unassignment clears ownership and returns the order to the pending pool.
CREATE OR REPLACE FUNCTION unassign_order(
  p_order_id UUID,
  p_actor_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_old_agent UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT id, status, assigned_to
    INTO v_order_id, v_current_status, v_old_agent
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  UPDATE orders
  SET
    assigned_to = NULL,
    status = 'pending',
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'pending', p_actor_id, 'manager', 'Agent desassigne')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'pending',
    'assigned_to', NULL,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- Return-to-pool is the manager-facing form of unassignment.
CREATE OR REPLACE FUNCTION return_order_to_pool(
  p_order_id UUID,
  p_actor_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status NOT IN (
    'pending',
    'assigned',
    'attempt_1',
    'attempt_2',
    'attempt_3',
    'callback_scheduled',
    'confirmed',
    'dispatch_scheduled'
  ) THEN
    RAISE EXCEPTION 'Cannot return to pool from status: %', v_current_status;
  END IF;

  UPDATE orders
  SET
    assigned_to = NULL,
    status = 'pending',
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'pending', p_actor_id, 'manager', 'Returned to pool by manager')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'pending',
    'assigned_to', NULL,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- Consolidated transition graph. Pending is the first actionable status;
-- assigned remains as a legacy input only.
CREATE OR REPLACE FUNCTION transition_order_status(
  p_order_id UUID,
  p_new_status order_status,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT 'system',
  p_note TEXT DEFAULT NULL,
  p_rejection_reason rejection_reason DEFAULT NULL,
  p_rejection_note TEXT DEFAULT NULL,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_auto BOOLEAN DEFAULT NULL,
  p_scheduled_carrier_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_valid BOOLEAN := false;
BEGIN
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('pending', 'attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'pending' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'deleted')
    WHEN 'confirmed' THEN p_new_status IN ('scanned', 'deleted', 'dispatch_scheduled')
    WHEN 'dispatch_scheduled' THEN p_new_status IN ('confirmed', 'scanned', 'deleted')
    WHEN 'dispatching' THEN p_new_status IN ('dispatched', 'confirmed')
    WHEN 'scanned' THEN p_new_status IN ('dispatched', 'deleted')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'unverified', 'cancelled', 'deleted')
    WHEN 'deposit' THEN p_new_status IN ('in_transit', 'unverified', 'cancelled')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned', 'unverified', 'cancelled')
    WHEN 'unverified' THEN p_new_status IN ('dispatched', 'deposit', 'in_transit', 'to_be_returned', 'delivered', 'cancelled')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned', 'received', 'cancelled')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  IF p_new_status = 'rejected' AND p_rejection_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason is required when transitioning to rejected';
  END IF;

  UPDATE orders
  SET
    status = p_new_status,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
    rejection_note   = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note   ELSE rejection_note END,
    callback_scheduled_at = CASE
      WHEN p_new_status = 'callback_scheduled' THEN p_callback_at
      WHEN v_current_status = 'callback_scheduled' THEN NULL
      ELSE callback_scheduled_at
    END,
    scheduled_dispatch_at = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_at
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_at
    END,
    scheduled_dispatch_auto = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN COALESCE(p_scheduled_auto, false)
      WHEN v_current_status = 'dispatch_scheduled' THEN false
      ELSE scheduled_dispatch_auto
    END,
    scheduled_dispatch_carrier_id = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_carrier_id
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_carrier_id
    END
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_new_status, p_actor_id, p_actor_type, p_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- First no-answer can start from pending as long as the caller has been
-- authorized by the API/RLS layer.
CREATE OR REPLACE FUNCTION no_response_with_auto_reject(
  p_order_id    UUID,
  p_next_attempt public.order_status,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id    UUID DEFAULT NULL,
  p_actor_type  TEXT DEFAULT 'agent'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status   public.order_status;
  v_order_id         UUID;
  v_market_id        UUID;
  v_updated_at       TIMESTAMPTZ;
  v_new_attempts     INTEGER;
  v_max_attempts     INTEGER;
  v_final_status     public.order_status;
  v_history_id       UUID;
  v_note             TEXT;
  v_attempt_status   public.order_status;
BEGIN
  SELECT id, status, market_id, attempts_count
  INTO v_order_id, v_current_status, v_market_id, v_new_attempts
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status NOT IN ('pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled') THEN
    RAISE EXCEPTION 'invalid no-answer from status %', v_current_status;
  END IF;

  v_new_attempts := v_new_attempts + 1;

  SELECT COALESCE((value->>'value')::INTEGER, 3)
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL THEN
    v_max_attempts := 3;
  END IF;

  v_attempt_status := CASE
    WHEN v_new_attempts >= 3 THEN 'attempt_3'::public.order_status
    WHEN v_new_attempts = 2 THEN 'attempt_2'::public.order_status
    ELSE 'attempt_1'::public.order_status
  END;

  IF v_new_attempts >= v_max_attempts THEN
    v_final_status := 'rejected';
    v_note := 'Auto-rejete - tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' atteint)';

    UPDATE orders
    SET
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejete : tentatives maximum atteintes',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'rejected'::public.order_status, NULL, 'system', v_note)
    RETURNING id INTO v_history_id;

  ELSIF p_callback_at IS NOT NULL THEN
    v_final_status := 'callback_scheduled';
    v_note := 'Tentative ' || v_new_attempts || ' - rappel programme';

    UPDATE orders
    SET
      status = 'callback_scheduled',
      attempts_count = v_new_attempts,
      callback_scheduled_at = p_callback_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'callback_scheduled'::public.order_status, p_actor_id, p_actor_type, v_note)
    RETURNING id INTO v_history_id;

  ELSE
    v_final_status := v_attempt_status;
    v_note := 'Tentative ' || v_new_attempts || ' - pas de reponse';

    UPDATE orders
    SET
      status = v_attempt_status,
      attempts_count = v_new_attempts,
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, v_attempt_status, p_actor_id, p_actor_type, v_note)
    RETURNING id INTO v_history_id;
  END IF;

  RETURN json_build_object(
    'order_id',       p_order_id,
    'new_status',     v_final_status,
    'auto_rejected',  v_final_status = 'rejected',
    'attempt_number', v_new_attempts,
    'attempts_count', v_new_attempts,
    'updated_at',     v_updated_at,
    'history_id',     v_history_id
  );
END;
$$;

-- Reopening an order returns it to the agent's pending queue.
CREATE OR REPLACE FUNCTION reopen_order(
  p_order_id    UUID,
  p_actor_id    UUID,
  p_void_outcome TEXT DEFAULT 'no_barcode'
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
  SELECT id, status, assigned_to, updated_at
    INTO v_order_id, v_status, v_assigned_to, v_updated_at
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_assigned_to IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Order not assigned to actor';
  END IF;

  IF v_status NOT IN ('rejected', 'confirmed', 'dispatched') THEN
    RAISE EXCEPTION 'Cannot reopen order in status %', v_status;
  END IF;

  IF v_updated_at < NOW() - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'Reopen window expired (updated_at = %)', v_updated_at;
  END IF;

  v_history_note := CASE p_void_outcome
    WHEN 'carrier_voided' THEN 'Reouvert - code-barres annule chez transporteur'
    WHEN 'local_only'     THEN 'Reouvert - annulation transporteur echouee, coordination manuelle requise'
    ELSE                       'Reouvert par agent'
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
  VALUES (p_order_id, v_status, 'pending'::order_status, p_actor_id, 'agent', v_history_note);

  RETURN json_build_object(
    'order_id',     p_order_id,
    'from_status',  v_status,
    'void_outcome', p_void_outcome
  );
END;
$$;
