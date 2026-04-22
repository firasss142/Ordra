-- ============================================================
-- 015_session9_no_response_rpc.sql
-- 1. Drop callback_time column (was added in 007, never cleaned up)
-- 2. Create/replace no_response_with_auto_reject RPC with correct logic:
--    - Reads max_call_attempts from settings (key = 'max_call_attempts', value = {"value": N})
--    - If attempt_number >= max_call_attempts → auto-reject with injoignable
--    - Otherwise → transition to attempt status, then optionally to callback_scheduled
-- ============================================================

-- 1. Drop the duplicate callback_time column
ALTER TABLE orders DROP COLUMN IF EXISTS callback_time;

-- 2. Replace no_response_with_auto_reject RPC with correct implementation
CREATE OR REPLACE FUNCTION no_response_with_auto_reject(
  p_order_id   UUID,
  p_next_attempt order_status,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id   UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status  order_status;
  v_order_id        UUID;
  v_market_id       UUID;
  v_history_id      UUID;
  v_updated_at      TIMESTAMPTZ;
  v_valid           BOOLEAN := false;
  v_attempt_number  INTEGER;
  v_max_attempts    INTEGER;
  v_final_status    order_status;
  v_reject_history_id UUID;
BEGIN
  -- Lock the row to prevent concurrent transitions
  SELECT id, status, market_id INTO v_order_id, v_current_status, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Validate the target is an attempt status
  IF p_next_attempt NOT IN ('attempt_1', 'attempt_2', 'attempt_3') THEN
    RAISE EXCEPTION 'next_attempt must be attempt_1, attempt_2, or attempt_3';
  END IF;

  -- Validate transition
  v_valid := CASE v_current_status
    WHEN 'assigned'           THEN p_next_attempt IN ('attempt_1')
    WHEN 'attempt_1'          THEN p_next_attempt IN ('attempt_2')
    WHEN 'attempt_2'          THEN p_next_attempt IN ('attempt_3')
    WHEN 'callback_scheduled' THEN p_next_attempt IN ('attempt_1', 'attempt_2', 'attempt_3')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_next_attempt;
  END IF;

  -- Extract attempt number from target status
  v_attempt_number := CASE p_next_attempt
    WHEN 'attempt_1' THEN 1
    WHEN 'attempt_2' THEN 2
    WHEN 'attempt_3' THEN 3
  END;

  -- Read max_call_attempts from settings (value stored as {"value": N})
  SELECT COALESCE((value->>'value')::INTEGER, 3)
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL THEN
    v_max_attempts := 3;
  END IF;

  -- Transition to the attempt status, clear callback
  UPDATE orders
  SET
    status = p_next_attempt,
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_next_attempt, p_actor_id, 'agent',
    'Pas de réponse — tentative ' || v_attempt_number)
  RETURNING id INTO v_history_id;

  v_final_status := p_next_attempt;

  -- Auto-reject if max attempts reached
  IF v_attempt_number >= v_max_attempts THEN
    UPDATE orders
    SET
      status = 'rejected',
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejeté : tentatives maximum atteintes',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, p_next_attempt, 'rejected', NULL, 'system',
      'Auto-rejeté : tentatives maximum (' || v_max_attempts || ') atteintes')
    RETURNING id INTO v_reject_history_id;

    v_final_status := 'rejected';

  -- Schedule callback if callback time provided and not auto-rejected
  ELSIF p_callback_at IS NOT NULL THEN
    UPDATE orders
    SET
      status = 'callback_scheduled',
      callback_scheduled_at = p_callback_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, p_next_attempt, 'callback_scheduled', p_actor_id, 'agent',
      'Rappel programmé après tentative ' || v_attempt_number)
    RETURNING id INTO v_reject_history_id;

    v_final_status := 'callback_scheduled';
  END IF;

  RETURN json_build_object(
    'order_id',      p_order_id,
    'new_status',    v_final_status,
    'auto_rejected', v_final_status = 'rejected',
    'attempt_number', v_attempt_number,
    'updated_at',    v_updated_at,
    'history_id',    COALESCE(v_reject_history_id, v_history_id)
  );
END;
$$;
