-- ============================================================
-- 20260821000002_carrier_warehouse_transitions.sql
-- Allow uploaded → dispatched for carrier-warehouse orders only.
--
-- WHY: when Darb Assabil fulfils from their own warehouse, the goods are
-- already on their shelves. Nobody here picks, prints, or scans the
-- package, so the normal uploaded → scanned step (scan_order_out) never
-- fires — and must not, because those units already left our stock once,
-- at physical handover to Darb. Without a new arm such orders would be
-- permanently stuck in `uploaded`.
--
-- The arm is deliberately narrow: it opens only when the order carries
-- carrier_extra->>'fulfil_from_carrier_warehouse' = 'true', which
-- perform-dispatch writes at upload time. Ordinary orders keep the
-- existing uploaded → scanned | deleted graph, so the warehouse scan
-- remains the one and only stock boundary for stock we hold.
--
-- Full body reproduced from 20260620000002_relax_confirmed_transitions.sql
-- with only the 'uploaded' branch changed.
-- ============================================================

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
  v_from_carrier_warehouse BOOLEAN := false;
BEGIN
  SELECT
    id,
    status,
    COALESCE(carrier_extra->>'fulfil_from_carrier_warehouse', 'false') = 'true'
  INTO v_order_id, v_current_status, v_from_carrier_warehouse
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
    -- relaxed: confirmed can revert to attempts / callback / rejected
    WHEN 'confirmed' THEN p_new_status IN (
      'attempt_1', 'attempt_2', 'attempt_3',
      'callback_scheduled', 'rejected',
      'uploaded', 'dispatch_scheduled', 'deleted'
    )
    WHEN 'dispatch_scheduled' THEN p_new_status IN ('uploaded', 'deleted')
    -- ↓ carrier-warehouse orders skip the local scan boundary entirely
    WHEN 'uploaded' THEN
      p_new_status IN ('scanned', 'deleted')
      OR (p_new_status = 'dispatched' AND v_from_carrier_warehouse)
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
