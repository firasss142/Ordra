-- ============================================================
-- 017_assign_order_note_param.sql
-- Add p_note parameter to assign_order so auto-assignment can
-- record the algorithm name in the order history entry.
-- Default NULL preserves backward compatibility with manual callers.
-- ============================================================

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
  v_history_id UUID;
  v_new_status order_status;
  v_updated_at TIMESTAMPTZ;
  v_agent_market_id UUID;
  v_note TEXT;
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

  -- Determine note: use caller-provided note if given, else default by context
  v_note := COALESCE(p_note,
    CASE WHEN v_current_status = 'new' THEN 'Assigned to agent'
         ELSE 'Reassigned to agent'
    END);

  -- Update the order
  UPDATE orders
  SET
    assigned_to = p_agent_id,
    status = v_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history record
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
