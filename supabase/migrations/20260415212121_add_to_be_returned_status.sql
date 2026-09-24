-- ============================================================
-- 018_add_to_be_returned_status.sql
-- Add 'to_be_returned' to order_status enum and update RPCs
-- ============================================================

-- 1. Add the missing enum value
ALTER TYPE order_status ADD VALUE 'to_be_returned' BEFORE 'delivered';

-- 2. Update transition_order_status RPC to include to_be_returned
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
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned')
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

-- 3. Update fulfill_order_transition RPC to include to_be_returned
CREATE OR REPLACE FUNCTION fulfill_order_transition(
  p_order_id UUID,
  p_new_status order_status,
  p_actor_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_is_damaged BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_valid BOOLEAN := false;
  v_needs_stock BOOLEAN := false;
  v_stock_change INTEGER := 0;
  v_current_stock INTEGER;
  v_damaged_count INTEGER;
  v_new_stock INTEGER;
  v_new_damaged INTEGER;
  v_log_reason TEXT;
  v_log_note TEXT;
  v_log_is_damaged BOOLEAN := false;
  v_balance_after INTEGER;
  v_history_id UUID;
  v_log_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  -- 1. Lock order row
  SELECT id, status, product_id, quantity, market_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- 2. Validate: is_damaged only valid for 'returned'
  IF p_is_damaged AND p_new_status != 'returned' THEN
    RAISE EXCEPTION 'is_damaged flag only valid for returned status';
  END IF;

  -- 3. Validate fulfillment transition (now includes to_be_returned)
  v_valid := CASE v_current_status
    WHEN 'dispatched' THEN p_new_status IN ('deposit')
    WHEN 'deposit' THEN p_new_status IN ('in_transit')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  -- 4. Determine stock effects
  IF p_new_status = 'deposit' THEN
    v_needs_stock := true;
    v_stock_change := -v_quantity;
    v_log_reason := 'deposit';
    v_log_note := 'Stock déduit au dépôt';
    v_log_is_damaged := false;
  ELSIF p_new_status = 'returned' AND NOT p_is_damaged THEN
    v_needs_stock := true;
    v_stock_change := v_quantity;
    v_log_reason := 'returned';
    v_log_note := 'Retour normal';
    v_log_is_damaged := false;
  ELSIF p_new_status = 'returned' AND p_is_damaged THEN
    v_needs_stock := true;
    v_stock_change := v_quantity;
    v_log_reason := 'damaged_writeoff';
    v_log_note := 'Retour endommagé';
    v_log_is_damaged := true;
  END IF;

  -- 5. If stock change needed, lock product and apply
  IF v_needs_stock THEN
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Order has no linked product for stock adjustment';
    END IF;

    SELECT current_stock, damaged_return_count
    INTO v_current_stock, v_damaged_count
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_product_id;
    END IF;

    IF p_new_status = 'deposit' THEN
      -- Deduct stock
      v_new_stock := v_current_stock + v_stock_change;
      IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'stock cannot go below zero';
      END IF;
      UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;
      v_balance_after := v_new_stock;

    ELSIF p_new_status = 'returned' AND NOT p_is_damaged THEN
      -- Restore stock
      v_new_stock := v_current_stock + v_stock_change;
      UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;
      v_balance_after := v_new_stock;

    ELSIF p_new_status = 'returned' AND p_is_damaged THEN
      -- Increment damaged count, no stock change
      v_new_damaged := v_damaged_count + v_stock_change;
      UPDATE products SET damaged_return_count = v_new_damaged WHERE id = v_product_id;
      v_balance_after := v_new_damaged;
    END IF;

    -- Insert inventory_log
    INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
    VALUES (v_product_id, p_order_id, v_stock_change, v_log_reason, v_balance_after, v_log_is_damaged, p_actor_id, v_log_note)
    RETURNING id INTO v_log_id;
  END IF;

  -- 6. Update order status
  UPDATE orders
  SET status = p_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- 7. Insert order_history
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_new_status, p_actor_id, 'manager', p_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;
