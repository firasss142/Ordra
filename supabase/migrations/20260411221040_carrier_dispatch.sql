-- ============================================================
-- 005_carrier_dispatch.sql
-- Schema changes + RPCs for carrier dispatch and agent queue
-- ============================================================

-- ============================================================
-- 1. Add carrier_extra to orders (Dexpress state_id/place_id audit trail)
-- ============================================================

ALTER TABLE orders ADD COLUMN carrier_extra JSONB;

-- ============================================================
-- 2. Dexpress reference tables (not market-scoped)
-- ============================================================

CREATE TABLE dexpress_states (
  id    INTEGER PRIMARY KEY,
  name  TEXT    NOT NULL UNIQUE
);

CREATE TABLE dexpress_places (
  id        INTEGER PRIMARY KEY,
  state_id  INTEGER NOT NULL REFERENCES dexpress_states(id),
  name      TEXT    NOT NULL,
  UNIQUE (state_id, name)
);

CREATE INDEX idx_dexpress_places_state ON dexpress_places (state_id);

-- ============================================================
-- 3. RLS for dexpress tables — read-only for all authenticated
-- ============================================================

ALTER TABLE dexpress_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE dexpress_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dexpress_states_read"
  ON dexpress_states FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "dexpress_places_read"
  ON dexpress_places FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 4. Update transition_order_status to handle callback_scheduled_at
-- ============================================================

CREATE OR REPLACE FUNCTION transition_order_status(
  p_order_id UUID,
  p_new_status order_status,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT 'system',
  p_note TEXT DEFAULT NULL,
  p_rejection_reason rejection_reason DEFAULT NULL,
  p_rejection_note TEXT DEFAULT NULL,
  p_callback_at TIMESTAMPTZ DEFAULT NULL
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
    rejection_note = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note ELSE rejection_note END,
    callback_scheduled_at = CASE
      WHEN p_new_status = 'callback_scheduled' THEN p_callback_at
      WHEN v_current_status = 'callback_scheduled' THEN NULL
      ELSE callback_scheduled_at
    END
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
-- 5. RPC: dispatch_order
-- Atomically: confirmed → dispatched + carrier metadata
-- ============================================================

CREATE OR REPLACE FUNCTION dispatch_order(
  p_order_id UUID,
  p_carrier_id UUID,
  p_tracking_number TEXT,
  p_carrier_extra JSONB DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
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
BEGIN
  -- Lock the row
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status != 'confirmed' THEN
    RAISE EXCEPTION 'Order must be confirmed to dispatch, current status: %', v_current_status;
  END IF;

  -- Update order with dispatch data
  UPDATE orders
  SET
    status = 'dispatched',
    carrier_id = p_carrier_id,
    tracking_number = p_tracking_number,
    carrier_extra = p_carrier_extra
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history: confirmed → dispatched
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'confirmed', 'dispatched', p_actor_id, 'system',
    'Dispatched to carrier, tracking: ' || p_tracking_number)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'dispatched',
    'tracking_number', p_tracking_number,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- ============================================================
-- 6. RPC: no_response_with_auto_reject
-- Atomically: increment attempt + optional auto-reject at max
-- ============================================================

CREATE OR REPLACE FUNCTION no_response_with_auto_reject(
  p_order_id UUID,
  p_next_attempt order_status,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
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
  v_updated_at TIMESTAMPTZ;
  v_valid BOOLEAN := false;
  v_attempt_number INTEGER;
  v_max_attempts INTEGER;
  v_final_status order_status;
  v_reject_history_id UUID;
BEGIN
  -- Lock the row
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
    WHEN 'assigned' THEN p_next_attempt IN ('attempt_1')
    WHEN 'attempt_1' THEN p_next_attempt IN ('attempt_2')
    WHEN 'attempt_2' THEN p_next_attempt IN ('attempt_3')
    WHEN 'callback_scheduled' THEN p_next_attempt IN ('attempt_1', 'attempt_2', 'attempt_3')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_next_attempt;
  END IF;

  -- Extract attempt number
  v_attempt_number := CASE p_next_attempt
    WHEN 'attempt_1' THEN 1
    WHEN 'attempt_2' THEN 2
    WHEN 'attempt_3' THEN 3
  END;

  -- Read max_call_attempts from settings (default 3)
  SELECT COALESCE((value->>'max_call_attempts')::INTEGER, 3)
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'confirmation';

  IF v_max_attempts IS NULL THEN
    v_max_attempts := 3;
  END IF;

  -- Transition to the attempt status
  UPDATE orders
  SET
    status = p_next_attempt,
    callback_scheduled_at = p_callback_at
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history for attempt transition
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_next_attempt, p_actor_id, 'agent', 'Pas de réponse')
  RETURNING id INTO v_history_id;

  v_final_status := p_next_attempt;

  -- Auto-reject if max attempts reached
  IF v_attempt_number >= v_max_attempts THEN
    UPDATE orders
    SET
      status = 'rejected',
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejected: max attempts reached',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, p_next_attempt, 'rejected', NULL, 'system',
      'Auto-rejected: max attempts (' || v_max_attempts || ') reached')
    RETURNING id INTO v_reject_history_id;

    v_final_status := 'rejected';
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', v_final_status,
    'auto_rejected', v_final_status = 'rejected',
    'updated_at', v_updated_at,
    'history_id', COALESCE(v_reject_history_id, v_history_id)
  );
END;
$$;
