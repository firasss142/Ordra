-- ============================================================
-- 010_fulfillment_transition.sql
-- Fulfillment orchestrator, return-to-pool, team metrics RPCs
-- ============================================================

-- ============================================================
-- Index for metrics queries on order_history
-- ============================================================

CREATE INDEX idx_order_history_status_to_created
  ON order_history (status_to, created_at);

-- ============================================================
-- RPC 1: fulfill_order_transition
-- Atomically: validate fulfillment transition → stock change → history + inventory_log
-- Locking order: orders first, then products (deadlock-safe)
-- ============================================================

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

  -- 3. Validate fulfillment transition
  v_valid := CASE v_current_status
    WHEN 'dispatched' THEN p_new_status IN ('deposit')
    WHEN 'deposit' THEN p_new_status IN ('in_transit')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'returned')
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

-- ============================================================
-- RPC 2: return_order_to_pool
-- Atomically: unassign + reset status to 'new' + clear callback
-- Only for pre-fulfillment statuses
-- ============================================================

CREATE OR REPLACE FUNCTION return_order_to_pool(
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
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  -- Lock order row
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Only allow return-to-pool for pre-fulfillment, non-terminal statuses
  IF v_current_status NOT IN ('assigned', 'attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Cannot return to pool from status: %', v_current_status;
  END IF;

  -- Reset order
  UPDATE orders
  SET
    assigned_to = NULL,
    status = 'new',
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'new', p_actor_id, 'manager', 'Returned to pool by manager')
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

-- ============================================================
-- RPC 3: get_team_overview
-- Single aggregation query for all agents in a market
-- Returns: agent_id, full_name, is_actif, queue_size, today_actioned
-- ============================================================

CREATE OR REPLACE FUNCTION get_team_overview(
  p_market_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO v_result
  FROM (
    SELECT
      u.id AS agent_id,
      u.full_name,
      -- Queue size: non-terminal orders assigned to this agent
      COALESCE(
        (SELECT COUNT(*)::INTEGER
         FROM orders o
         WHERE o.assigned_to = u.id
           AND o.status NOT IN ('delivered', 'returned', 'rejected', 'cancelled')
        ), 0
      ) AS queue_size,
      -- Active: had an action in last 2 hours
      EXISTS (
        SELECT 1 FROM order_history oh
        WHERE oh.actor_id = u.id
          AND oh.created_at >= NOW() - INTERVAL '2 hours'
      ) AS is_actif,
      -- Today's actioned count
      COALESCE(
        (SELECT COUNT(DISTINCT oh2.order_id)::INTEGER
         FROM order_history oh2
         WHERE oh2.actor_id = u.id
           AND oh2.status_to IN ('confirmed', 'dispatched', 'rejected')
           AND oh2.created_at >= CURRENT_DATE
        ), 0
      ) AS today_actioned
    FROM users u
    WHERE u.role = 'agent'
      AND u.market_id = p_market_id
      AND u.is_active = true
    ORDER BY u.full_name
  ) t;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$;

-- ============================================================
-- RPC 4: get_agent_metrics
-- Metrics: actioned count, confirmation rate, avg attempts
-- Period-filtered against order_history.created_at
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_metrics(
  p_market_id UUID,
  p_from_date TIMESTAMPTZ,
  p_to_date TIMESTAMPTZ,
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH actioned AS (
    SELECT DISTINCT oh.order_id
    FROM order_history oh
    JOIN orders o ON o.id = oh.order_id
    WHERE oh.status_to IN ('confirmed', 'dispatched', 'rejected')
      AND oh.created_at >= p_from_date
      AND oh.created_at < p_to_date
      AND o.market_id = p_market_id
      AND (p_agent_id IS NULL OR oh.actor_id = p_agent_id)
  ),
  counts AS (
    SELECT
      (SELECT COUNT(*)::INTEGER FROM actioned) AS actioned_count,
      (SELECT COUNT(DISTINCT oh.order_id)::INTEGER
       FROM order_history oh
       WHERE oh.order_id IN (SELECT order_id FROM actioned)
         AND oh.status_to IN ('confirmed', 'dispatched')
         AND oh.created_at >= p_from_date
         AND oh.created_at < p_to_date
      ) AS confirmed_count
  ),
  attempts AS (
    SELECT COALESCE(SUM(attempt_count)::INTEGER, 0) AS total_attempts
    FROM (
      SELECT COUNT(*)::INTEGER AS attempt_count
      FROM order_history oh
      WHERE oh.order_id IN (SELECT order_id FROM actioned)
        AND oh.status_to IN ('attempt_1', 'attempt_2', 'attempt_3')
      GROUP BY oh.order_id
    ) sub
  )
  SELECT json_build_object(
    'actioned_count', c.actioned_count,
    'confirmed_count', c.confirmed_count,
    'confirmation_rate', CASE WHEN c.actioned_count > 0
      THEN ROUND(c.confirmed_count::NUMERIC / c.actioned_count * 100, 1)
      ELSE 0
    END,
    'avg_attempts', CASE WHEN c.actioned_count > 0
      THEN ROUND(a.total_attempts::NUMERIC / c.actioned_count, 2)
      ELSE 0
    END
  ) INTO v_result
  FROM counts c, attempts a;

  RETURN v_result;
END;
$$;
