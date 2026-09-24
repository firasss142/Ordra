-- scan_received_in: warehouse re-receives a failed-delivery package.
-- Transitions order from to_be_returned → received (NON-terminal — re-deliverable).
-- Stock +qty, inventory_log row with reason='received_back'.
-- Distinct from scan_return_in which marks the order terminal-returned.

CREATE OR REPLACE FUNCTION scan_received_in(
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
  v_customer_name TEXT;
  v_actor_market_id UUID;
  v_actor_role TEXT;
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
    RAISE EXCEPTION 'Actor role % cannot scan received', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id, customer_name
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id, v_customer_name
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

  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  v_new_stock := v_current_stock + v_quantity;
  UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;

  INSERT INTO inventory_log (
    product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note
  )
  VALUES (
    v_product_id, p_order_id, v_quantity, 'received_back', v_new_stock, false,
    p_actor_id, 'Réception sans clôture — colis re-déposé en stock'
  )
  RETURNING id INTO v_log_id;

  UPDATE orders SET status = 'received' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_order_id, 'to_be_returned', 'received', p_actor_id, 'agent',
    'Colis re-réceptionné (non clos, re-livrable)'
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'customer_name', v_customer_name,
    'status', 'received',
    'balance_after', v_new_stock,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scan_received_in(UUID, UUID) TO authenticated;
