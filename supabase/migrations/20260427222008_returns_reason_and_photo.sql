-- ============================================================
-- 20260424_returns_reason_and_photo.sql
-- RETOURS redesign — decision-first, with reason + photo evidence
--
-- Adds:
--   * enum return_reason (packaging | product_defect | customer_damage | carrier_damage | other)
--   * inventory_log columns: return_reason, return_photo_url, return_reason_note
--   * scan_return_in — new signature with reason/photo/note params + validation
--   * view product_return_rate_view — per-product return rate stats
-- ============================================================

-- 1. Return reason enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_reason') THEN
    CREATE TYPE return_reason AS ENUM (
      'packaging',
      'product_defect',
      'customer_damage',
      'carrier_damage',
      'other'
    );
  END IF;
END $$;

-- 2. Extend inventory_log (nullable — only populated on damaged writeoffs)
ALTER TABLE inventory_log
  ADD COLUMN IF NOT EXISTS return_reason      return_reason NULL,
  ADD COLUMN IF NOT EXISTS return_photo_url   TEXT          NULL,
  ADD COLUMN IF NOT EXISTS return_reason_note TEXT          NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_log_return_reason
  ON inventory_log (return_reason)
  WHERE return_reason IS NOT NULL;

-- 3. scan_return_in — replace with extended signature
-- Drop the previous 3-arg version so the new 6-arg version is the only one.
DROP FUNCTION IF EXISTS scan_return_in(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION scan_return_in(
  p_order_id           UUID,
  p_actor_id           UUID,
  p_is_damaged         BOOLEAN       DEFAULT false,
  p_return_reason      return_reason DEFAULT NULL,
  p_return_photo_url   TEXT          DEFAULT NULL,
  p_return_reason_note TEXT          DEFAULT NULL
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
  v_trimmed_note TEXT;
BEGIN
  -- Validation: reason required on damaged; reason_note required when reason=other.
  IF p_is_damaged AND p_return_reason IS NULL THEN
    RAISE EXCEPTION 'return_reason is required when is_damaged=true';
  END IF;

  v_trimmed_note := NULLIF(btrim(COALESCE(p_return_reason_note, '')), '');
  IF p_is_damaged AND p_return_reason = 'other' AND v_trimmed_note IS NULL THEN
    RAISE EXCEPTION 'return_reason_note is required when return_reason=other';
  END IF;

  -- Actor check
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users
  WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan returns', v_actor_role;
  END IF;

  -- Lock order row
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

  INSERT INTO inventory_log (
    product_id, order_id, change, reason, balance_after, is_damaged,
    actor_id, note, return_reason, return_photo_url, return_reason_note
  )
  VALUES (
    v_product_id, p_order_id, v_stock_change, v_log_reason, v_balance_after, p_is_damaged,
    p_actor_id, v_log_note,
    CASE WHEN p_is_damaged THEN p_return_reason ELSE NULL END,
    CASE WHEN p_is_damaged THEN p_return_photo_url ELSE NULL END,
    CASE WHEN p_is_damaged THEN v_trimmed_note ELSE NULL END
  )
  RETURNING id INTO v_log_id;

  UPDATE orders SET status = 'returned' WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_order_id, 'to_be_returned', 'returned', p_actor_id, 'agent',
    CASE
      WHEN p_is_damaged THEN 'Retour scanné (endommagé: ' || p_return_reason::TEXT || ')'
      ELSE 'Retour scanné'
    END
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'customer_name', v_customer_name,
    'status', 'returned',
    'is_damaged', p_is_damaged,
    'return_reason', p_return_reason,
    'return_photo_url', CASE WHEN p_is_damaged THEN p_return_photo_url ELSE NULL END,
    'balance_after', v_balance_after,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

-- 4. Per-product return-rate view
-- denominator = delivered + returned + damaged (i.e. orders that reached a
-- terminal fulfillment state). Rate as percentage with 1 decimal precision
-- computed at the client.
CREATE OR REPLACE VIEW product_return_rate_view AS
SELECT
  p.id AS product_id,
  p.market_id,
  COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END), 0)::INTEGER AS delivered_count,
  COALESCE(SUM(CASE WHEN o.status = 'returned' AND NOT EXISTS (
    SELECT 1 FROM inventory_log il
    WHERE il.order_id = o.id AND il.is_damaged = true
  ) THEN 1 ELSE 0 END), 0)::INTEGER AS returned_count,
  COALESCE(SUM(CASE WHEN o.status = 'returned' AND EXISTS (
    SELECT 1 FROM inventory_log il
    WHERE il.order_id = o.id AND il.is_damaged = true
  ) THEN 1 ELSE 0 END), 0)::INTEGER AS damaged_count
FROM products p
LEFT JOIN orders o
  ON o.product_id = p.id
  AND o.status IN ('delivered', 'returned')
GROUP BY p.id, p.market_id;

COMMENT ON VIEW product_return_rate_view IS
  'Per-product fulfillment outcome counts. Denominator for return rate = delivered + returned + damaged.';
