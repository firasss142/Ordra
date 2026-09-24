-- ============================================================
-- 021_translate_assignment_notes_fr.sql
-- Translate English assignment history notes to French so the
-- UI never renders untranslated English strings in order history.
-- Touches: assign_order (default note), unassign_order (note).
-- ============================================================

-- Update assign_order (latest signature from 017) — change default note to French
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
  SELECT id, status, market_id INTO v_order_id, v_current_status, v_market_id
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

  IF v_current_status = 'new' THEN
    v_new_status := 'assigned';
  ELSE
    v_new_status := v_current_status;
  END IF;

  v_note := COALESCE(p_note,
    CASE WHEN v_current_status = 'new' THEN 'Assigné à l''agent'
         ELSE 'Réassigné à l''agent'
    END);

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

-- Update unassign_order — change note to French
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
  SELECT id, status, assigned_to INTO v_order_id, v_current_status, v_old_agent
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  UPDATE orders
  SET
    assigned_to = NULL,
    status = 'new',
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'new', p_actor_id, 'manager', 'Agent désassigné')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'new',
    'assigned_to', NULL,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;
