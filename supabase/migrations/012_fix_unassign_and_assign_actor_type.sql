-- ============================================================
-- 012_fix_unassign_and_assign_actor_type.sql
-- 1. Fix unassign_order: reset status to 'new' + clear callback
-- 2. Add p_actor_type parameter to assign_order (default 'manager')
-- ============================================================

-- ============================================================
-- Fix 0: Add SKU column to products table for webhook product lookup
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_market_sku
  ON products(market_id, sku) WHERE sku IS NOT NULL;

-- ============================================================
-- Fix 1: unassign_order — align with return_order_to_pool
-- Resets status to 'new', clears assigned_to and callback.
-- ============================================================

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
  -- Lock order row
  SELECT id, status, assigned_to INTO v_order_id, v_current_status, v_old_agent
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Reset order to pool state
  UPDATE orders
  SET
    assigned_to = NULL,
    status = 'new',
    callback_scheduled_at = NULL
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history record
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, 'new', p_actor_id, 'manager', 'Unassigned from agent')
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
-- Fix 2: assign_order — add p_actor_type parameter
-- Default 'manager' preserves backward compatibility.
-- Auto-assignment passes 'system'.
-- ============================================================

CREATE OR REPLACE FUNCTION assign_order(
  p_order_id UUID,
  p_agent_id UUID,
  p_actor_id UUID,
  p_actor_type TEXT DEFAULT 'manager'
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

  -- Update the order
  UPDATE orders
  SET
    assigned_to = p_agent_id,
    status = v_new_status
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  -- Insert history record (uses p_actor_type instead of hardcoded 'manager')
  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, v_new_status, p_actor_id, p_actor_type,
    CASE WHEN v_current_status = 'new' THEN 'Assigned to agent'
         ELSE 'Reassigned to agent'
    END)
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
