-- ============================================================
-- 004_order_rpcs.sql
-- Atomic RPCs for order status transitions and assignment
-- ============================================================

-- ============================================================
-- RPC 1: transition_order_status
-- Atomically validates transition, updates status, inserts history.
-- Transition graph mirrors src/types/order-status.ts TRANSITIONS.
-- ============================================================

CREATE OR REPLACE FUNCTION transition_order_status(
  p_order_id UUID,
  p_new_status order_status,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT 'system',
  p_note TEXT DEFAULT NULL,
  p_rejection_reason rejection_reason DEFAULT NULL,
  p_rejection_note TEXT DEFAULT NULL
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
  -- Lock the row to prevent concurrent transitions
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Validate transition against the same graph as TypeScript canTransition()
  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('assigned')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'cancelled')
    WHEN 'confirmed' THEN p_new_status IN ('dispatched', 'cancelled')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'cancelled')
    WHEN 'deposit' THEN p_new_status IN ('in_transit')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'returned')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  -- Update the order
  UPDATE orders
  SET
    status = p_new_status,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
    rejection_note = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note ELSE rejection_note END
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert immutable history record
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

-- ============================================================
-- RPC 2: assign_order
-- Atomically sets assigned_to, transitions new→assigned if applicable,
-- and inserts history record.
-- ============================================================

CREATE OR REPLACE FUNCTION assign_order(
  p_order_id UUID,
  p_agent_id UUID,
  p_actor_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_market_id UUID;
  v_history_id UUID;
  v_new_status order_status;
  v_updated_at TIMESTAMPTZ;
  v_agent_market_id UUID;
BEGIN
  -- Lock order row
  SELECT id, status, market_id INTO v_order_id, v_current_status, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Verify agent exists, is active, and belongs to same market
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

  -- If order is 'new', transition to 'assigned'; otherwise keep current status
  IF v_current_status = 'new' THEN
    v_new_status := 'assigned';
  ELSE
    v_new_status := v_current_status;
  END IF;

  -- Update the order
  UPDATE orders
  SET
    assigned_to = p_agent_id,
    status = v_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history record
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, v_new_status, p_actor_id, 'manager',
    CASE WHEN v_current_status = 'new' THEN 'Assigned to agent'
         ELSE 'Reassigned to agent'
    END)
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

-- ============================================================
-- RPC 3: unassign_order
-- Sets assigned_to to NULL and inserts history record.
-- ============================================================

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
  -- Lock order row
  SELECT id, status, assigned_to INTO v_order_id, v_current_status, v_old_agent
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Update the order
  UPDATE orders
  SET assigned_to = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history record
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, v_current_status, p_actor_id, 'manager', 'Unassigned from agent')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', v_current_status,
    'assigned_to', NULL,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;
