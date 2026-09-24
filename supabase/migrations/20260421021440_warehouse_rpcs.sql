-- ============================================================
-- 20260421_warehouse_rpcs.sql
-- Warehouse agent feature — RPC layer
--
-- Changes:
--   * transition_order_status: confirmed → scanned → dispatched (was confirmed → dispatched)
--   * fulfill_order_transition: stock -1 moves from 'deposit' to 'scanned'
--   * NEW scan_order_out(p_order_id): confirmed → scanned, stock -1, requires label_prints row
--   * NEW scan_return_in(p_order_id, p_is_damaged): to_be_returned → returned, stock +1 or damaged_count++
-- ============================================================

-- ------------------------------------------------------------
-- transition_order_status — graph updated for the scanned step
-- ------------------------------------------------------------
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
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('assigned')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'cancelled')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'cancelled')
    WHEN 'confirmed' THEN p_new_status IN ('scanned', 'cancelled')
    WHEN 'scanned' THEN p_new_status IN ('dispatched', 'cancelled')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'cancelled')
    WHEN 'deposit' THEN p_new_status IN ('in_transit')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  UPDATE orders
  SET
    status = p_new_status,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
    rejection_note   = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note   ELSE rejection_note END
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

-- ------------------------------------------------------------
-- fulfill_order_transition — stock -1 moves out of 'deposit'
-- ------------------------------------------------------------
-- Why: physical stock leaves the warehouse when the warehouse agent scans
-- the order ('scanned' status). 'deposit' keeps its financial role
-- (carrier fees start) but no longer mutates current_stock.
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
  SELECT id, status, product_id, quantity
  INTO v_order_id, v_current_status, v_product_id, v_quantity
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF p_is_damaged AND p_new_status != 'returned' THEN
    RAISE EXCEPTION 'is_damaged flag only valid for returned status';
  END IF;

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

  -- Stock effects: returned (+1 or damaged_count++) only. Deposit no longer
  -- touches stock (stock already decremented at the earlier 'scanned' step).
  IF p_new_status = 'returned' AND NOT p_is_damaged THEN
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

    IF p_new_status = 'returned' AND NOT p_is_damaged THEN
      v_new_stock := v_current_stock + v_stock_change;
      UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;
      v_balance_after := v_new_stock;

    ELSIF p_new_status = 'returned' AND p_is_damaged THEN
      v_new_damaged := v_damaged_count + v_stock_change;
      UPDATE products SET damaged_return_count = v_new_damaged WHERE id = v_product_id;
      v_balance_after := v_new_damaged;
    END IF;

    INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
    VALUES (v_product_id, p_order_id, v_stock_change, v_log_reason, v_balance_after, v_log_is_damaged, p_actor_id, v_log_note)
    RETURNING id INTO v_log_id;
  END IF;

  UPDATE orders
  SET status = p_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

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

-- ------------------------------------------------------------
-- scan_order_out — warehouse agent scan of an outgoing (confirmed) order
-- ------------------------------------------------------------
-- Atomically: confirmed → scanned, stock -1, inventory_log insert,
-- order_history insert. Rejects orders without a label_prints row
-- (can't scan what hasn't been labeled).
CREATE OR REPLACE FUNCTION scan_order_out(
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
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_has_label BOOLEAN;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users
  WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan out', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;

  IF v_current_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Order is not in confirmed status (current: %)', v_current_status;
  END IF;

  SELECT EXISTS (SELECT 1 FROM label_prints WHERE order_id = p_order_id) INTO v_has_label;
  IF NOT v_has_label THEN
    RAISE EXCEPTION 'Order has no printed label — print label before scanning';
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  v_new_stock := v_current_stock - v_quantity;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'stock cannot go below zero';
  END IF;

  UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;

  INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
  VALUES (v_product_id, p_order_id, -v_quantity, 'scanned', v_new_stock, false, p_actor_id, 'Scan sortie entrepôt')
  RETURNING id INTO v_log_id;

  UPDATE orders SET status = 'scanned' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'confirmed', 'scanned', p_actor_id, 'agent', 'Scanné par l''entrepôt')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', v_new_stock,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

-- ------------------------------------------------------------
-- scan_return_in — warehouse agent scan of an incoming return
-- ------------------------------------------------------------
-- Atomically: to_be_returned → returned, stock +1 (if not damaged)
-- or damaged_return_count++ (if damaged). Order status must be
-- to_be_returned (manager has flagged the return from in_transit).
CREATE OR REPLACE FUNCTION scan_return_in(
  p_order_id UUID,
  p_actor_id UUID,
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
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_current_stock INTEGER;
  v_damaged_count INTEGER;
  v_new_stock INTEGER;
  v_new_damaged INTEGER;
  v_balance_after INTEGER;
  v_log_reason TEXT;
  v_log_note TEXT;
  v_stock_change INTEGER;
  v_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users
  WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan returns', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;

  IF v_current_status <> 'to_be_returned' THEN
    RAISE EXCEPTION 'Order is not in to_be_returned status (current: %)', v_current_status;
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  v_stock_change := v_quantity;

  SELECT current_stock, damaged_return_count
  INTO v_current_stock, v_damaged_count
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  IF p_is_damaged THEN
    v_new_damaged := v_damaged_count + v_stock_change;
    UPDATE products SET damaged_return_count = v_new_damaged WHERE id = v_product_id;
    v_balance_after := v_new_damaged;
    v_log_reason := 'damaged_writeoff';
    v_log_note := 'Scan retour endommagé';
  ELSE
    v_new_stock := v_current_stock + v_stock_change;
    UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;
    v_balance_after := v_new_stock;
    v_log_reason := 'returned';
    v_log_note := 'Scan retour normal';
  END IF;

  INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
  VALUES (v_product_id, p_order_id, v_stock_change, v_log_reason, v_balance_after, p_is_damaged, p_actor_id, v_log_note)
  RETURNING id INTO v_log_id;

  UPDATE orders SET status = 'returned' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'to_be_returned', 'returned', p_actor_id, 'agent',
          CASE WHEN p_is_damaged THEN 'Retour scanné (endommagé)' ELSE 'Retour scanné' END)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'returned',
    'is_damaged', p_is_damaged,
    'balance_after', v_balance_after,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;
