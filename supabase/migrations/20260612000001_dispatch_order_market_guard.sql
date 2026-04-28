-- ============================================================
-- dispatch_order: defense-in-depth market isolation guard
-- ============================================================
-- Adds carrier↔order market alignment check + carrier active check
-- inside the RPC. The application layer (performDispatch) already
-- validates this, but enforcing in the RPC prevents any future caller
-- from bypassing the check. Negligible cost: one indexed PK lookup
-- on `carriers` per dispatch.
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
  v_current_status     order_status;
  v_order_id           UUID;
  v_order_market_id    UUID;
  v_carrier_market_id  UUID;
  v_carrier_active     BOOLEAN;
  v_history_id         UUID;
  v_updated_at         TIMESTAMPTZ;
BEGIN
  -- Lock the order row and read its market_id
  SELECT id, status, market_id
    INTO v_order_id, v_current_status, v_order_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Look up carrier market + active state
  SELECT market_id, is_active
    INTO v_carrier_market_id, v_carrier_active
  FROM carriers
  WHERE id = p_carrier_id;

  IF v_carrier_market_id IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;

  IF v_carrier_market_id <> v_order_market_id THEN
    RAISE EXCEPTION 'Carrier does not belong to the order''s market';
  END IF;

  IF NOT v_carrier_active THEN
    RAISE EXCEPTION 'Carrier is not active';
  END IF;

  IF v_current_status <> 'confirmed' THEN
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
